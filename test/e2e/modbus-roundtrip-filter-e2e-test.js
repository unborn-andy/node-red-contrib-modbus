/**
 * Full Modbus TCP roundtrip via node-red-node-test-helper:
 * Flex-Write → Flex-Getter (IO payload) → Response-Filter → assert value.
 */

'use strict'

const assert = require('assert')
const catchNode = require('@node-red/nodes/core/common/25-catch')
const injectNode = require('@node-red/nodes/core/common/20-inject')
const clientNode = require('../../src/modbus-client.js')
const serverNode = require('../../src/modbus-server.js')
const flexGetterNode = require('../../src/modbus-flex-getter.js')
const flexWriteNode = require('../../src/modbus-flex-write.js')
const responseFilterNode = require('../../src/modbus-response-filter.js')
const ioConfigNode = require('../../src/modbus-io-config.js')

const helper = require('node-red-node-test-helper')
helper.init(require.resolve('node-red'))

const flows = require('../integrations/flows/modbus-roundtrip-load-flows')
const {
  getPort,
  waitForModbusClientActive,
  waitForModbusServerListening,
  validateFlowFixture
} = require('../helper/test-helper-extensions')

const nodes = [
  catchNode,
  injectNode,
  clientNode,
  serverNode,
  flexGetterNode,
  flexWriteNode,
  responseFilterNode,
  ioConfigNode
]

const CI = !!process.env.CI
const SUITE_MS = CI ? 90000 : 45000
const CLIENT_WAIT_MS = CI ? 30000 : 15000
const SERVER_WAIT_MS = CI ? 15000 : 5000
const MSG_WAIT_MS = CI ? 20000 : 12000

function onceDone (done) {
  let settled = false
  return function (err) {
    if (settled) return
    settled = true
    done(err)
  }
}

function prepareFlow (template, port) {
  const flow = JSON.parse(JSON.stringify(template))
  for (const node of flow) {
    if (!node) continue
    if (node.type === 'modbus-server') {
      node.serverPort = port
      node.responseDelay = CI ? 10 : 5
    }
    if (node.type === 'modbus-client') {
      node.tcpPort = port
      node.clientTimeout = CI ? 5000 : 3000
      node.commandDelay = CI ? 10 : 1
    }
  }
  validateFlowFixture(flow)
  return flow
}

function loadRoundtrip (cb) {
  getPort().then((port) => {
    const flow = prepareFlow(flows.roundtripFilterFlow, port)
    helper.load(nodes, flow, function (err) {
      if (err) return cb(err)
      const server = helper.getNode('serverRt')
      const client = helper.getNode('clientRt')
      waitForModbusServerListening(server, function (sErr) {
        if (sErr) return cb(sErr)
        waitForModbusClientActive(client, function (cErr) {
          if (cErr) return cb(cErr)
          cb(null, { client, port })
        }, CLIENT_WAIT_MS)
      }, SERVER_WAIT_MS)
    })
  }).catch(cb)
}

describe('E2E Modbus roundtrip + Response-Filter', function () {
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

  it('FC6 write → FC3 read → Response-Filter returns written holding value', function (done) {
    const finish = onceDone(done)
    const MAGIC = 4242

    loadRoundtrip(function (err) {
      if (err) return finish(err)

      const flexWrite = helper.getNode('flexWriteRt')
      const flexGet = helper.getNode('flexGetRt')
      const helperWrite = helper.getNode('helperWrite')
      const helperFilter = helper.getNode('helperFilter')
      const ioNode = helper.getNode('ioRt')

      assert.ok(ioNode, 'IO config node must load')
      assert.ok(Array.isArray(ioNode.configData) && ioNode.configData.length >= 1, 'IO file must be parsed')

      helperFilter.once('input', function (msg) {
        try {
          assert.ok(Array.isArray(msg.payload), 'filter output should be array')
          assert.strictEqual(msg.payload.length, 1, 'filter should keep only iRoundTrip')
          assert.strictEqual(msg.payload[0].name, 'iRoundTrip')
          assert.strictEqual(msg.payload[0].value, MAGIC)
          finish()
        } catch (e) {
          finish(e)
        }
      })

      helperWrite.once('input', function () {
        flexGet.receive({
          payload: { fc: 3, unitid: 1, address: 0, quantity: 3 }
        })
      })

      flexWrite.receive({
        payload: { fc: 6, unitid: 1, address: 0, quantity: 1, value: MAGIC }
      })

      setTimeout(() => finish(new Error('timeout FC6→FC3→Filter roundtrip')), MSG_WAIT_MS)
    })
  })

  it('FC16 multi-write → FC3 read → Filter keeps only iRoundTrip', function (done) {
    const finish = onceDone(done)

    loadRoundtrip(function (err) {
      if (err) return finish(err)

      const flexWrite = helper.getNode('flexWriteRt')
      const flexGet = helper.getNode('flexGetRt')
      const helperWrite = helper.getNode('helperWrite')
      const helperFilter = helper.getNode('helperFilter')

      helperFilter.once('input', function (msg) {
        try {
          assert.strictEqual(msg.payload.length, 1)
          assert.strictEqual(msg.payload[0].name, 'iRoundTrip')
          assert.strictEqual(msg.payload[0].value, 111)
          finish()
        } catch (e) {
          finish(e)
        }
      })

      helperWrite.once('input', function () {
        flexGet.receive({
          payload: { fc: 3, unitid: 1, address: 0, quantity: 3 }
        })
      })

      flexWrite.receive({
        payload: {
          fc: 16,
          unitid: 1,
          address: 0,
          quantity: 3,
          value: [111, 222, 333]
        }
      })

      setTimeout(() => finish(new Error('timeout FC16→FC3→Filter roundtrip')), MSG_WAIT_MS)
    })
  })

  it('FC5 coil write → FC1 read path still allows Filter IO holding roundtrip after', function (done) {
    // Coil path + subsequent holding filter roundtrip proves mixed FC traffic on same client
    const finish = onceDone(done)
    const MAGIC = 7777

    loadRoundtrip(function (err) {
      if (err) return finish(err)

      const flexWrite = helper.getNode('flexWriteRt')
      const flexGet = helper.getNode('flexGetRt')
      const helperWrite = helper.getNode('helperWrite')
      const helperFilter = helper.getNode('helperFilter')

      helperWrite.once('input', function () {
        // after coil write succeeds, do holding roundtrip through filter
        helperWrite.once('input', function () {
          helperFilter.once('input', function (msg) {
            try {
              assert.strictEqual(msg.payload[0].value, MAGIC)
              finish()
            } catch (e) {
              finish(e)
            }
          })
          flexGet.receive({
            payload: { fc: 3, unitid: 1, address: 0, quantity: 3 }
          })
        })

        flexWrite.receive({
          payload: { fc: 6, unitid: 1, address: 0, quantity: 1, value: MAGIC }
        })
      })

      flexWrite.receive({
        payload: { fc: 5, unitid: 1, address: 0, quantity: 1, value: true }
      })

      setTimeout(() => finish(new Error('timeout mixed FC5 then holding filter')), MSG_WAIT_MS)
    })
  })
})
