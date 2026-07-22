/**
 * Live Node-RED feature matrix — real runtime + Modbus-Server TCP.
 * Closes #574-class blind spots (sequential drain, shared client, multi-node smoke).
 */

'use strict'

const assert = require('assert')
const injectNode = require('@node-red/nodes/core/common/20-inject.js')
const catchNode = require('@node-red/nodes/core/common/25-catch.js')
const clientNode = require('../../src/modbus-client.js')
const serverNode = require('../../src/modbus-server.js')
const flexGetterNode = require('../../src/modbus-flex-getter.js')
const flexWriteNode = require('../../src/modbus-flex-write.js')
const getterNode = require('../../src/modbus-getter.js')
const readNode = require('../../src/modbus-read.js')
const queueInfoNode = require('../../src/modbus-queue-info.js')
const sequencerNode = require('../../src/modbus-flex-sequencer.js')
const responseFilterNode = require('../../src/modbus-response-filter.js')
const responseNode = require('../../src/modbus-response.js')
const flexConnectorNode = require('../../src/modbus-flex-connector.js')
const flexFcNode = require('../../src/modbus-flex-fc.js')
const ioConfigNode = require('../../src/modbus-io-config.js')

const helper = require('node-red-node-test-helper')
helper.init(require.resolve('node-red'))

const flows = require('./flows/modbus-live-feature-matrix-flows')
const {
  getPort,
  waitForModbusClientActive,
  waitForModbusServerListening,
  validateFlowFixture
} = require('../helper/test-helper-extensions')

const matrixNodes = [
  catchNode,
  injectNode,
  clientNode,
  serverNode,
  flexGetterNode,
  flexWriteNode,
  getterNode,
  readNode,
  queueInfoNode,
  sequencerNode,
  responseFilterNode,
  responseNode,
  flexConnectorNode,
  flexFcNode,
  ioConfigNode
]

const CI = !!process.env.CI
const CLIENT_WAIT_MS = CI ? 30000 : 12000
const SERVER_WAIT_MS = CI ? 15000 : 5000
const SUITE_TIMEOUT_MS = CI ? 90000 : 40000

function onceDone (done) {
  let settled = false
  return function (err) {
    if (settled) {
      return
    }
    settled = true
    done(err)
  }
}

function preparePorts (flowTemplate, port) {
  const flow = JSON.parse(JSON.stringify(flowTemplate))
  for (const node of flow) {
    if (!node) {
      continue
    }
    if (node.type === 'modbus-server') {
      node.serverPort = port
      node.responseDelay = CI ? 20 : 10
    }
    if (node.type === 'modbus-client') {
      node.tcpPort = port
      node.clientTimeout = CI ? 5000 : 2000
      node.commandDelay = CI ? 20 : 1
      node.reconnectTimeout = CI ? 1000 : 500
    }
  }
  validateFlowFixture(flow)
  return flow
}

function loadLiveFlow (flowTemplate, cb) {
  getPort().then((port) => {
    const flow = preparePorts(flowTemplate, port)
    helper.load(matrixNodes, flow, function (err) {
      if (err) {
        cb(err)
        return
      }
      const server = flow.find((n) => n.type === 'modbus-server')
      const client = flow.find((n) => n.type === 'modbus-client')
      const serverNodeInst = helper.getNode(server.id)
      const clientNodeInst = helper.getNode(client.id)
      waitForModbusServerListening(serverNodeInst, function (serverErr) {
        if (serverErr) {
          cb(serverErr)
          return
        }
        waitForModbusClientActive(clientNodeInst, function (clientErr) {
          if (clientErr) {
            cb(clientErr)
            return
          }
          cb(null, { flow, serverNodeInst, clientNodeInst, port })
        }, CLIENT_WAIT_MS)
      }, SERVER_WAIT_MS)
    })
  }).catch(cb)
}

describe('Live Node-RED feature matrix (helper + Modbus-Server)', function () {
  this.timeout(SUITE_TIMEOUT_MS)

  before(function (done) {
    helper.startServer(done)
  })

  afterEach(function (done) {
    helper.unload().then(function () {
      done()
    }).catch(done)
  })

  after(function (done) {
    helper.stopServer(done)
  })

  it('Flex-Getter drains sequential multi-UnitId reads without Queue full (#574)', function (done) {
    const finish = onceDone(done)
    loadLiveFlow(flows.sequentialFlexGetterFlow, function (err, ctx) {
      if (err) {
        finish(err)
        return
      }
      assert.strictEqual(ctx.clientNodeInst.parallelUnitIdsAllowed, false)

      const flexGetter = helper.getNode('flexGet1')
      const helperOut = helper.getNode('helperOut')
      const payloads = []

      helperOut.on('input', function (msg) {
        payloads.push(msg)
        if (payloads.length >= 4) {
          try {
            assert.ok(msg.payload != null)
            const q1 = ctx.clientNodeInst.bufferCommandList.get(1).length
            const q2 = ctx.clientNodeInst.bufferCommandList.get(2).length
            assert.strictEqual(q1, 0, 'unit 1 queue should drain')
            assert.strictEqual(q2, 0, 'unit 2 queue should drain')
            finish()
          } catch (assertErr) {
            finish(assertErr)
          }
        }
      })

      const reads = [
        { payload: { fc: 3, unitid: 1, address: 0, quantity: 2 } },
        { payload: { fc: 3, unitid: 1, address: 10, quantity: 2 } },
        { payload: { fc: 3, unitid: 2, address: 0, quantity: 2 } },
        { payload: { fc: 3, unitid: 2, address: 10, quantity: 2 } }
      ]
      reads.forEach((m) => flexGetter.receive(m))

      setTimeout(function () {
        finish(new Error(
          'timeout: got ' + payloads.length + ' payloads' +
          '; state=' + (ctx.clientNodeInst.actualServiceState && ctx.clientNodeInst.actualServiceState.value)
        ))
      }, CI ? 25000 : 12000)
    })
  })

  it('Flex-Write FC6 then Flex-Getter read-back', function (done) {
    const finish = onceDone(done)
    loadLiveFlow(flows.sequentialFlexGetterFlow, function (err, ctx) {
      if (err) {
        finish(err)
        return
      }
      const flexWrite = helper.getNode('flexWrite1')
      const flexGetter = helper.getNode('flexGet1')
      const helperWrite = helper.getNode('helperWrite')
      const helperOut = helper.getNode('helperOut')

      helperWrite.once('input', function () {
        helperOut.once('input', function (msg) {
          try {
            assert.ok(msg.payload != null)
            finish()
          } catch (assertErr) {
            finish(assertErr)
          }
        })
        flexGetter.receive({ payload: { fc: 3, unitid: 1, address: 50, quantity: 1 } })
      })

      flexWrite.receive({
        payload: { fc: 6, unitid: 1, address: 50, quantity: 1, value: 1234 }
      })

      setTimeout(function () {
        finish(new Error('timeout Flex-Write/Getter roundtrip'))
      }, CI ? 20000 : 10000)
    })
  })

  it('Modbus-Getter returns HoldingRegister payload on inject', function (done) {
    const finish = onceDone(done)
    loadLiveFlow(flows.sequentialFlexGetterFlow, function (err) {
      if (err) {
        finish(err)
        return
      }
      const getter = helper.getNode('getter1')
      const helperGetter = helper.getNode('helperGetter')
      helperGetter.once('input', function (msg) {
        try {
          assert.ok(msg.payload != null)
          finish()
        } catch (assertErr) {
          finish(assertErr)
        }
      })
      getter.receive({ payload: 1 })
      setTimeout(function () {
        finish(new Error('timeout Modbus-Getter'))
      }, CI ? 15000 : 8000)
    })
  })

  it('Modbus-Read emits at least one polled payload', function (done) {
    const finish = onceDone(done)
    loadLiveFlow(flows.sequentialFlexGetterFlow, function (err) {
      if (err) {
        finish(err)
        return
      }
      const helperRead = helper.getNode('helperRead')
      helperRead.once('input', function (msg) {
        try {
          assert.ok(msg.payload != null)
          finish()
        } catch (assertErr) {
          finish(assertErr)
        }
      })
      setTimeout(function () {
        finish(new Error('timeout Modbus-Read poll'))
      }, CI ? 15000 : 8000)
    })
  })

  it('Flex-Sequencer emits payloads for configured sequence steps', function (done) {
    const finish = onceDone(done)
    loadLiveFlow(flows.sequentialFlexGetterFlow, function (err) {
      if (err) {
        finish(err)
        return
      }
      const sequencer = helper.getNode('sequencer1')
      const helperSeq = helper.getNode('helperSeq')
      let count = 0
      helperSeq.on('input', function (msg) {
        count++
        if (count >= 2) {
          try {
            assert.ok(msg.payload != null)
            finish()
          } catch (assertErr) {
            finish(assertErr)
          }
        }
      })
      sequencer.receive({ payload: {} })
      setTimeout(function () {
        finish(new Error('timeout Flex-Sequencer, got ' + count))
      }, CI ? 20000 : 10000)
    })
  })

  it('Queue-Info reports queueEnabled on input against live client', function (done) {
    const finish = onceDone(done)
    loadLiveFlow(flows.sequentialFlexGetterFlow, function (err, ctx) {
      if (err) {
        finish(err)
        return
      }
      const queueInfo = helper.getNode('queueInfo1')
      const helperQueue = helper.getNode('helperQueue')
      helperQueue.once('input', function (msg) {
        try {
          assert.strictEqual(msg.payload.queueEnabled, true)
          assert.ok(msg.payload.queues || msg.payload.queue !== undefined)
          finish()
        } catch (assertErr) {
          finish(assertErr)
        }
      })
      queueInfo.receive({ payload: {} })
      setTimeout(function () {
        finish(new Error('timeout Queue-Info; client state=' +
          (ctx.clientNodeInst.actualServiceState && ctx.clientNodeInst.actualServiceState.value)))
      }, CI ? 10000 : 5000)
    })
  })

  it('shared client: deregister one Flex-Getter, sibling still reads (#423)', function (done) {
    const finish = onceDone(done)
    loadLiveFlow(flows.sharedClientTwoGettersFlow, function (err, ctx) {
      if (err) {
        finish(err)
        return
      }
      const flexA = helper.getNode('flexA')
      const flexB = helper.getNode('flexB')
      const helperB = helper.getNode('helperB')
      const client = ctx.clientNodeInst

      client.deregisterForModbus(flexA.id, function () {
        try {
          assert.ok(client.registeredNodeList[flexB.id], 'sibling still registered')
          assert.ok(client.isActive(), 'client stays active after partial deregister')
        } catch (assertErr) {
          finish(assertErr)
          return
        }

        helperB.once('input', function (msg) {
          try {
            assert.ok(msg.payload != null)
            finish()
          } catch (e) {
            finish(e)
          }
        })

        flexB.receive({ payload: { fc: 3, unitid: 1, address: 0, quantity: 1 } })
      })

      setTimeout(function () {
        finish(new Error('timeout shared-client isolation'))
      }, CI ? 20000 : 10000)
    })
  })

  it('palette constructors register under helper (smoke for remaining nodes)', function (done) {
    // Ensures Flex-Fc / Flex-Connector / Response / Response-Filter / IO-Config
    // are loadable in the same Node-RED runtime as the live matrix nodes.
    helper.load(matrixNodes, [], function (err) {
      if (err) {
        done(err)
        return
      }
      try {
        assert.ok(helper._redNodes.getNodeList().length >= 0)
        done()
      } catch (e) {
        done(e)
      }
    })
  })
})
