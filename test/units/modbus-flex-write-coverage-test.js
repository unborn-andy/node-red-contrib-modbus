/**
 * Functional coverage tests for modbus-flex-write (FC 5/6/15/16, Modbus spec validation).
 */

'use strict'

const injectNode = require('@node-red/nodes/core/common/20-inject.js')
const catchNode = require('@node-red/nodes/core/common/25-catch.js')
const functionNode = require('@node-red/nodes/core/function/10-function.js')
const clientNode = require('../../src/modbus-client.js')
const serverNode = require('../../src/modbus-server.js')
const nodeUnderTest = require('../../src/modbus-flex-write.js')
const helper = require('node-red-node-test-helper')
helper.init(require.resolve('node-red'))
const testFlows = require('./flows/modbus-flex-write-flows')
const {
  getPort,
  waitForModbusClientActive,
  waitForModbusServerListening
} = require('../helper/test-helper-extensions')

const testNodes = [catchNode, injectNode, functionNode, clientNode, serverNode, nodeUnderTest]

const CI_TEST_TIMEOUT_MS = process.env.CI ? 90000 : 30000
const CLIENT_ACTIVE_WAIT_MS = process.env.CI ? 30000 : 15000
const SERVER_LISTEN_WAIT_MS = process.env.CI ? 15000 : 5000
const POST_LOAD_SETTLE_MS = process.env.CI ? 500 : 100
const WRITE_DONE_TIMEOUT_MS = process.env.CI ? 20000 : 15000
const INTER_WRITE_DELAY_MS = process.env.CI ? 250 : 0

let flowSeq = 0

function prepareFlow (flowTemplate) {
  const flow = JSON.parse(JSON.stringify(flowTemplate))
  const suffix = '-' + Date.now().toString(36) + '-' + (++flowSeq)
  const idMap = {}

  for (const node of flow) {
    if (!node || !node.id) {
      continue
    }
    const nextId = node.id + suffix
    idMap[node.id] = nextId
    node.id = nextId
  }

  for (const node of flow) {
    if (!node) {
      continue
    }
    if (node.server && idMap[node.server]) {
      node.server = idMap[node.server]
    }
    if (Array.isArray(node.wires)) {
      node.wires = node.wires.map((outputs) => {
        if (!Array.isArray(outputs)) {
          return outputs
        }
        return outputs.map((targetId) => idMap[targetId] || targetId)
      })
    }
    if (node.scope && Array.isArray(node.scope)) {
      node.scope = node.scope.map((targetId) => idMap[targetId] || targetId)
    }

    if (node.type === 'modbus-flex-write') {
      node.delayOnStart = false
      node.startDelayTime = 1
    }
    if (node.type === 'modbus-client') {
      // Flow fixtures use clientTimeout=100ms — too tight under parallel CI load.
      node.clientTimeout = process.env.CI ? 5000 : 2000
      node.commandDelay = process.env.CI ? 50 : 1
      node.reconnectOnTimeout = true
      node.tcpAlwaysReconnect = true
      node.reconnectTimeout = process.env.CI ? 1000 : 500
      node.serialConnectionDelay = 100
    }
    if (node.type === 'modbus-server') {
      node.responseDelay = process.env.CI ? 20 : (node.responseDelay || 50)
    }
  }

  return { flow, idMap }
}

function waitForFlexWriteReady (flexWrite, modbusClient, maxWaitMs, callback) {
  const deadline = Date.now() + maxWaitMs
  const poll = () => {
    const delayOk = flexWrite.delayOccured === true
    const clientOk = modbusClient && typeof modbusClient.isActive === 'function' &&
      modbusClient.isActive() && modbusClient.client
    if (delayOk && clientOk) {
      callback()
      return
    }
    if (Date.now() >= deadline) {
      const state = modbusClient && modbusClient.actualServiceState && modbusClient.actualServiceState.value
      callback(new Error(
        'flex-write not ready within ' + maxWaitMs + 'ms' +
        ' (delayOccured=' + flexWrite.delayOccured +
        ', state=' + state +
        ', clientActive=' + !!(modbusClient && modbusClient.isActive && modbusClient.isActive()) + ')'
      ))
      return
    }
    setTimeout(poll, 50)
  }
  poll()
}

function nudgeClientConnect (modbusClient) {
  if (!modbusClient || typeof modbusClient.connectClient !== 'function') {
    return
  }
  const state = modbusClient.actualServiceState && modbusClient.actualServiceState.value
  if (state === 'init' || state === 'closed' || state === 'failed' || state === 'broken') {
    try {
      modbusClient.connectClient()
    } catch (err) {
      // ignore — waitForModbusClientActive still owns the timeout
    }
  }
}

function loadFlexWriteFlow (flowTemplate, nodeId, onReady, done) {
  const prepared = prepareFlow(flowTemplate)
  const flow = prepared.flow
  const flexWriteId = prepared.idMap[nodeId] || nodeId
  const clientConfig = flow.find((n) => n.type === 'modbus-client')
  const serverConfig = flow.find((n) => n.type === 'modbus-server')
  const clientId = clientConfig ? clientConfig.id : null
  const serverId = serverConfig ? serverConfig.id : null

  const load = () => {
    helper.load(testNodes, flow, function () {
      setTimeout(function () {
        const flexWrite = helper.getNode(flexWriteId)
        const modbusClient = clientId ? helper.getNode(clientId) : null
        const modbusServer = serverId ? helper.getNode(serverId) : null
        if (!flexWrite || !modbusClient) {
          done(new Error('flex-write or modbus-client node missing after load'))
          return
        }

        const startClientWait = () => {
          let started = false
          const onActive = () => {
            if (started) {
              return
            }
            started = true
            modbusClient.removeListener('mbactive', onActive)
            waitForFlexWriteReady(flexWrite, modbusClient, 5000, (readyErr) => {
              if (readyErr) {
                done(readyErr)
                return
              }
              onReady(flexWrite, modbusClient, done)
            })
          }

          modbusClient.once('mbactive', onActive)
          nudgeClientConnect(modbusClient)

          waitForModbusClientActive(modbusClient, (err) => {
            if (err) {
              modbusClient.removeListener('mbactive', onActive)
              if (!started) {
                done(err)
              }
              return
            }
            onActive()
          }, CLIENT_ACTIVE_WAIT_MS)

          // One reconnect nudge after server should already be listening.
          setTimeout(function () {
            if (!started && (!modbusClient.isActive || !modbusClient.isActive())) {
              nudgeClientConnect(modbusClient)
            }
          }, process.env.CI ? 1500 : 500)
        }

        if (modbusServer) {
          waitForModbusServerListening(modbusServer, (listenErr) => {
            if (listenErr) {
              done(listenErr)
              return
            }
            startClientWait()
          }, SERVER_LISTEN_WAIT_MS)
        } else {
          startClientWait()
        }
      }, POST_LOAD_SETTLE_MS)
    })
  }

  if (serverConfig && clientConfig) {
    getPort().then((port) => {
      serverConfig.serverPort = port
      clientConfig.tcpPort = port
      load()
    }).catch(done)
  } else {
    load()
  }
}

function receiveAndWaitForDone (flexWrite, modbusClient, payload, done) {
  let settled = false
  const finish = (err) => {
    if (settled) {
      return
    }
    settled = true
    clearTimeout(timer)
    flexWrite.removeListener('modbusFlexWriteNodeDone', onDone)
    flexWrite.removeListener('modbusFlexWriteNodeError', onError)
    if (err) {
      done(err)
    } else if (INTER_WRITE_DELAY_MS > 0) {
      setTimeout(done, INTER_WRITE_DELAY_MS)
    } else {
      done()
    }
  }

  const onError = function () {
    finish(new Error('flex write failed for payload: ' + payload))
  }
  const onDone = function () {
    finish()
  }

  const timer = setTimeout(function () {
    finish(new Error('flex write timed out for payload: ' + payload))
  }, WRITE_DONE_TIMEOUT_MS)

  flexWrite.once('modbusFlexWriteNodeError', onError)
  flexWrite.once('modbusFlexWriteNodeDone', onDone)

  waitForFlexWriteReady(flexWrite, modbusClient, 5000, (err) => {
    if (err) {
      finish(err)
      return
    }
    if (typeof flexWrite.isNotReadyForInput === 'function' && flexWrite.isNotReadyForInput()) {
      finish(new Error('flex-write rejected input (not ready) for payload: ' + payload))
      return
    }
    if (modbusClient && typeof modbusClient.isInactive === 'function' && modbusClient.isInactive()) {
      finish(new Error('modbus client inactive before write for payload: ' + payload))
      return
    }
    flexWrite.receive({ payload })
  })
}

describe('Flex Write Coverage — functional Modbus writes', function () {
  this.timeout(CI_TEST_TIMEOUT_MS)

  before(function (done) {
    helper.startServer(done)
  })

  afterEach(function (done) {
    helper.unload().then(function () {
      done()
    }).catch(function () {
      done()
    })
  })

  after(function (done) {
    helper.stopServer(done)
  })

  describe('functional writes against modbus-server', function () {
    // One flow only: a second helper.load with the same config-node id left the
    // client stuck in FSM state=init under parallel CI (hasClient=true, never active).
    it('should write FC5–16 and update status activities in one loaded flow', function (done) {
      loadFlexWriteFlow(testFlows.testWriteParametersFlow, '82fe7fe4.7b7bc8', function (flexWrite, modbusClient, done) {
        receiveAndWaitForDone(flexWrite, modbusClient,
          '{ "value": true, "fc": 5, "unitid": 1, "address": 0, "quantity": 1 }',
          function () {
            receiveAndWaitForDone(flexWrite, modbusClient,
              '{ "value": 42, "fc": 6, "unitid": 1, "address": 0, "quantity": 1 }',
              function () {
                receiveAndWaitForDone(flexWrite, modbusClient,
                  '{ "value": [true, false, true, false], "fc": 15, "unitid": 1, "address": 0, "quantity": 4 }',
                  function () {
                    receiveAndWaitForDone(flexWrite, modbusClient,
                      '{ "value": [100, 200, 300], "fc": 16, "unitid": 1, "address": 0, "quantity": 3 }',
                      function () {
                        flexWrite.showStatusActivities = true
                        receiveAndWaitForDone(flexWrite, modbusClient,
                          '{ "value": true, "fc": 5, "unitid": 1, "address": 1, "quantity": 1 }',
                          done)
                      })
                  })
              })
          })
      }, done)
    })
  })
})
