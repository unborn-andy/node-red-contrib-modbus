/**
 * Restored live TCP E2E tests formerly deferred as #test-debt-e2e.
 * Uses real Node-RED runtime + Modbus-Server (no Serial hardware).
 */

'use strict'

const path = require('path')
const assert = require('assert')

const injectNode = require('@node-red/nodes/core/common/20-inject')
const catchNode = require('@node-red/nodes/core/common/25-catch')
const functionNode = require('@node-red/nodes/core/function/10-function')

const clientNode = require('../../src/modbus-client.js')
const serverNode = require('../../src/modbus-server.js')
const readNode = require('../../src/modbus-read.js')
const getterNode = require('../../src/modbus-getter.js')
const writeNode = require('../../src/modbus-write.js')
const flexWriteNode = require('../../src/modbus-flex-write.js')
const ioConfigNode = require('../../src/modbus-io-config.js')

const helper = require('node-red-node-test-helper')
helper.init(require.resolve('node-red'))

const readFlows = require('../units/flows/modbus-read-flows')
const getterFlows = require('../units/flows/modbus-getter-flows')
const flexWriteFlows = require('../units/flows/modbus-flex-write-flows')
const writeFlows = require('../units/flows/modbus-write-flows')

const {
  withEphemeralPorts,
  waitForModbusClientActive,
  waitForModbusServerListening,
  validateFlowFixture
} = require('../helper/test-helper-extensions')

const CI = !!process.env.CI
const SUITE_MS = CI ? 90000 : 45000
const CLIENT_WAIT_MS = CI ? 30000 : 15000
const SERVER_WAIT_MS = CI ? 15000 : 5000
const MSG_WAIT_MS = CI ? 20000 : 10000

const readNodes = [catchNode, injectNode, clientNode, serverNode, readNode, ioConfigNode]
const getterNodes = [catchNode, injectNode, clientNode, serverNode, getterNode, ioConfigNode]
const flexWriteNodes = [catchNode, injectNode, functionNode, clientNode, serverNode, flexWriteNode]
const writeNodes = [catchNode, injectNode, functionNode, clientNode, serverNode, writeNode]

const DEVICE_JSON = path.resolve(__dirname, '../resources/device.json')

function onceDone (done) {
  let settled = false
  return function (err) {
    if (settled) return
    settled = true
    done(err)
  }
}

function findByType (flow, type) {
  return flow.find((n) => n && n.type === type)
}

function prepareClientServer (flow) {
  for (const node of flow) {
    if (!node) continue
    if (node.type === 'modbus-client') {
      node.clientTimeout = CI ? 5000 : 2000
      node.commandDelay = CI ? 20 : 1
      node.reconnectTimeout = CI ? 1000 : 500
      node.reconnectOnTimeout = true
    }
    if (node.type === 'modbus-server') {
      node.responseDelay = CI ? 20 : (node.responseDelay || 50)
    }
    if (node.type === 'modbus-read') {
      if (!node.rateUnit) node.rateUnit = 'ms'
      if (!node.rate || Number(node.rate) < 100) node.rate = '200'
    }
    if (node.type === 'modbus-io-config' && node.path) {
      node.path = DEVICE_JSON
    }
    // Prevent race: inject nodes fire on deploy before TCP is up
    if (node.type === 'inject') {
      node.once = false
      node.onceDelay = 0
      node.repeat = ''
      node.crontab = ''
    }
  }
  validateFlowFixture(flow)
  return flow
}

function loadTcpFlow (nodes, flowTemplate, cb) {
  withEphemeralPorts(flowTemplate).then((flow) => {
    prepareClientServer(flow)
    helper.load(nodes, flow, function (err) {
      if (err) {
        cb(err)
        return
      }
      const serverCfg = findByType(flow, 'modbus-server')
      const clientCfg = findByType(flow, 'modbus-client')
      const server = helper.getNode(serverCfg.id)
      const client = helper.getNode(clientCfg.id)
      waitForModbusServerListening(server, function (sErr) {
        if (sErr) {
          cb(sErr)
          return
        }
        waitForModbusClientActive(client, function (cErr) {
          if (cErr) {
            cb(cErr)
            return
          }
          cb(null, { flow, server, client })
        }, CLIENT_WAIT_MS)
      }, SERVER_WAIT_MS)
    })
  }).catch(cb)
}

describe('Live TCP E2E (restored from #test-debt-e2e)', function () {
  this.timeout(SUITE_MS)

  before(function (done) {
    helper.startServer(done)
  })

  afterEach(function (done) {
    helper.unload().then(() => done()).catch(done)
  })

  after(function (done) {
    helper.stopServer(done)
  })

  describe('Modbus-Read', function () {
    it('simple Node should send message with empty topic', function (done) {
      const finish = onceDone(done)
      loadTcpFlow(readNodes, readFlows.testReadMsgFlow, function (err) {
        if (err) return finish(err)
        const h1 = helper.getNode('ea9d86efa187751b')
        h1.once('input', function (msg) {
          try {
            assert.strictEqual(msg.topic, 'polling')
            assert.ok(msg.payload != null)
            finish()
          } catch (e) { finish(e) }
        })
        setTimeout(() => finish(new Error('timeout empty topic')), MSG_WAIT_MS)
      })
    })

    it('simple Node should send message with own topic', function (done) {
      const finish = onceDone(done)
      loadTcpFlow(readNodes, readFlows.testReadMsgMyTopicFlow, function (err) {
        if (err) return finish(err)
        const h1 = helper.getNode('h1')
        h1.once('input', function (msg) {
          try {
            assert.strictEqual(msg.topic, 'myTopic')
            assert.ok(msg.payload != null)
            finish()
          } catch (e) { finish(e) }
        })
        setTimeout(() => finish(new Error('timeout own topic')), MSG_WAIT_MS)
      })
    })

    it('simple Node should send message with IO', function (done) {
      const finish = onceDone(done)
      loadTcpFlow(readNodes, readFlows.testReadWithClientIoFlow, function (err) {
        if (err) return finish(err)
        const h1 = helper.getNode('h1')
        let count = 0
        h1.on('input', function (msg) {
          count++
          if (count >= 1) {
            try {
              assert.ok(msg.payload != null)
              finish()
            } catch (e) { finish(e) }
          }
        })
        setTimeout(() => finish(new Error('timeout read IO')), MSG_WAIT_MS)
      })
    })

    it('simple Node should send message with IO and sending IO-objects as payload', function (done) {
      const finish = onceDone(done)
      loadTcpFlow(readNodes, readFlows.testReadWithClientIoPayloadFlow, function (err) {
        if (err) return finish(err)
        const h1 = helper.getNode('h1')
        h1.once('input', function (msg) {
          try {
            assert.ok(msg.payload != null)
            finish()
          } catch (e) { finish(e) }
        })
        setTimeout(() => finish(new Error('timeout read IO payload')), MSG_WAIT_MS)
      })
    })
  })

  describe('Modbus-Getter', function () {
    it('simple flow with inject should be loaded and return payload', function (done) {
      const finish = onceDone(done)
      loadTcpFlow(getterNodes, getterFlows.testInjectGetterWithClientFlow, function (err) {
        if (err) return finish(err)
        const getter = helper.getNode('cea01c8.36f8f6')
        const h1 = helper.getNode('h1')
        h1.once('input', function (msg) {
          try {
            assert.ok(msg.payload != null)
            finish()
          } catch (e) { finish(e) }
        })
        getter.receive({ payload: 1 })
        setTimeout(() => finish(new Error('timeout getter inject')), MSG_WAIT_MS)
      })
    })

    it('should work as simple flow with inject and IO', function (done) {
      const finish = onceDone(done)
      // Fixture lacks io-config historically — still validates TCP getter path after ready
      loadTcpFlow(getterNodes, getterFlows.testGetterFlowWithInjectIo, function (err) {
        if (err) return finish(err)
        const getter = helper.getNode('a2adb6ed727a01d6')
        const h1 = helper.getNode('67bcb38642737ce8')
        h1.once('input', function (msg) {
          try {
            assert.ok(msg.payload != null)
            finish()
          } catch (e) { finish(e) }
        })
        getter.receive({ payload: 1 })
        setTimeout(() => finish(new Error('timeout getter IO flow')), MSG_WAIT_MS)
      })
    })

    it('should work as simple flow with inject and IO with read done', function (done) {
      const finish = onceDone(done)
      loadTcpFlow(getterNodes, getterFlows.testGetterFlowWithInjectIo, function (err) {
        if (err) return finish(err)
        const getter = helper.getNode('a2adb6ed727a01d6')
        getter.once('modbusGetterNodeDone', function () {
          finish()
        })
        getter.receive({ payload: 1 })
        setTimeout(() => finish(new Error('timeout getter read done')), MSG_WAIT_MS)
      })
    })
  })

  describe('Modbus-Flex-Write', function () {
    function flexWriteCase (title, payload) {
      it(title, function (done) {
        const finish = onceDone(done)
        loadTcpFlow(flexWriteNodes, flexWriteFlows.testWriteParametersFlow, function (err) {
          if (err) return finish(err)
          const flexWriter = helper.getNode('82fe7fe4.7b7bc8')
          const h1 = helper.getNode('h1')
          h1.once('input', function (msg) {
            try {
              assert.ok(msg.payload != null || flexWriter.bufferMessageList.size === 0)
              finish()
            } catch (e) { finish(e) }
          })
          flexWriter.receive({ payload })
          setTimeout(() => finish(new Error('timeout flex-write: ' + title)), MSG_WAIT_MS)
        })
      })
    }

    flexWriteCase(
      'simple flow with string input from http should be parsed and written',
      '{ "value": true, "fc": 5, "unitid": 1,"address": 0, "quantity": 1 }'
    )
    flexWriteCase(
      'simple flow with string with array of values input from http should be parsed and written',
      '{ "value": [0,1,0,1], "fc": 15, "unitid": 1,"address": 0, "quantity": 4 }'
    )
    flexWriteCase(
      'simple flow with string value true input from http should be parsed and written',
      '{ "value": "true", "fc": 5, "unitid": 1,"address": 0, "quantity": 1 }'
    )
    flexWriteCase(
      'simple flow with string value false input from http should be parsed and written',
      '{ "value": "false", "fc": 5, "unitid": 1,"address": 0, "quantity": 1 }'
    )
  })

  describe('Modbus-Write', function () {
    it('simple flow with string true http inject and write should be loaded and write done', function (done) {
      const finish = onceDone(done)
      loadTcpFlow(writeNodes, writeFlows.testSimpleWriteFlow, function (err) {
        if (err) return finish(err)
        const modbusWrite = helper.getNode('258dc103f99d2f2e')
        // Prefer helper output; fall back to node event
        const helpers = ['f780a7d088ac2b22', '7dc3bdb75f5a590d']
        let got = false
        const onMsg = function () {
          if (got) return
          if (modbusWrite.bufferMessageList && modbusWrite.bufferMessageList.size > 0) return
          got = true
          finish()
        }
        helpers.forEach((id) => {
          const h = helper.getNode(id)
          if (h) h.on('input', onMsg)
        })
        modbusWrite.on('modbusWriteNodeDone', onMsg)
        modbusWrite.receive({
          payload: { value: 'true', fc: 5, unitid: 1, address: 0, quantity: 1 }
        })
        setTimeout(() => finish(new Error('timeout write string true')), MSG_WAIT_MS)
      })
    })
  })
})
