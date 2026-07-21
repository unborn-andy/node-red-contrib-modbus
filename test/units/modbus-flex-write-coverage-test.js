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
const { getPort, waitForModbusClientActive } = require('../helper/test-helper-extensions')

const testNodes = [catchNode, injectNode, functionNode, clientNode, serverNode, nodeUnderTest]

const CI_TEST_TIMEOUT_MS = process.env.CI ? 120000 : 30000
const CLIENT_ACTIVE_WAIT_MS = process.env.CI ? 45000 : 15000
const POST_LOAD_SETTLE_MS = process.env.CI ? 1500 : 300
const WRITE_DONE_TIMEOUT_MS = process.env.CI ? 30000 : 15000
const INTER_WRITE_DELAY_MS = process.env.CI ? 250 : 0

function prepareFlow (flowTemplate) {
  const flow = Array.from(flowTemplate)
  for (const node of flow) {
    if (node.type === 'modbus-flex-write') {
      node.delayOnStart = false
      node.startDelayTime = 1
    }
    if (node.type === 'modbus-client') {
      // Flow fixtures use clientTimeout=100ms — too tight under parallel CI load.
      node.clientTimeout = process.env.CI ? 5000 : 2000
      node.commandDelay = process.env.CI ? 50 : 1
      node.reconnectOnTimeout = false
      node.tcpAlwaysReconnect = false
      node.reconnectTimeout = 2000
    }
    if (node.type === 'modbus-server') {
      node.responseDelay = process.env.CI ? 20 : (node.responseDelay || 50)
    }
  }
  return flow
}

function getFlowClientId (flow) {
  const client = flow.find((n) => n.type === 'modbus-client')
  return client ? client.id : null
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
      callback(new Error(
        'flex-write not ready within ' + maxWaitMs + 'ms' +
        ' (delayOccured=' + flexWrite.delayOccured +
        ', clientActive=' + !!(modbusClient && modbusClient.isActive && modbusClient.isActive()) + ')'
      ))
      return
    }
    setTimeout(poll, 50)
  }
  poll()
}

function loadFlexWriteFlow (flowTemplate, nodeId, onReady, done) {
  const flow = prepareFlow(flowTemplate)
  const clientConfig = flow.find((n) => n.type === 'modbus-client')
  const server = flow.find((n) => n.type === 'modbus-server')
  const clientId = getFlowClientId(flow)

  const load = () => {
    helper.load(testNodes, flow, function () {
      setTimeout(function () {
        const flexWrite = helper.getNode(nodeId)
        const modbusClient = clientId ? helper.getNode(clientId) : null
        if (!flexWrite || !modbusClient) {
          done(new Error('flex-write or modbus-client node missing after load'))
          return
        }
        waitForModbusClientActive(modbusClient, (err) => {
          if (err) {
            done(err)
            return
          }
          waitForFlexWriteReady(flexWrite, modbusClient, CLIENT_ACTIVE_WAIT_MS, (readyErr) => {
            if (readyErr) {
              done(readyErr)
              return
            }
            onReady(flexWrite, modbusClient, done)
          })
        }, CLIENT_ACTIVE_WAIT_MS)
      }, POST_LOAD_SETTLE_MS)
    })
  }

  if (server && clientConfig) {
    getPort().then((port) => {
      server.serverPort = port
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
    // Silent drop in flex-write input when not ready — fail fast instead of hanging.
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
    it('should write FC5, FC6, FC15 and FC16 in one loaded flow', function (done) {
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
                      done)
                  })
              })
          })
      }, done)
    })

    it('should update status on input when showStatusActivities is enabled', function (done) {
      loadFlexWriteFlow(testFlows.testModbusFlexWriteFlow, 'dcb6fa4b3549ae4f', function (flexWrite, modbusClient, done) {
        flexWrite.showStatusActivities = true
        receiveAndWaitForDone(flexWrite, modbusClient,
          '{ "value": true, "fc": 5, "unitid": 1, "address": 1, "quantity": 1 }',
          done)
      }, done)
    })
  })
})
