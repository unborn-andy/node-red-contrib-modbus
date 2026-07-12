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

const CI_TEST_TIMEOUT_MS = process.env.CI ? 60000 : 30000
const CLIENT_ACTIVE_WAIT_MS = process.env.CI ? 35000 : 15000

function prepareFlow (flowTemplate) {
  const flow = Array.from(flowTemplate)
  const flexWrite = flow.find((n) => n.type === 'modbus-flex-write')
  if (flexWrite) {
    flexWrite.delayOnStart = false
  }
  return flow
}

function loadFlexWriteFlow (flowTemplate, nodeId, onReady, done) {
  const flow = prepareFlow(flowTemplate)
  const client = flow.find((n) => n.type === 'modbus-client')
  const server = flow.find((n) => n.type === 'modbus-server')

  const load = () => {
    helper.load(testNodes, flow, function () {
      const flexWrite = helper.getNode(nodeId)
      const modbusClient = helper.getNode('80aeec4c.0cb9e8')
      waitForModbusClientActive(modbusClient, (err) => {
        if (err) {
          done(err)
          return
        }
        onReady(flexWrite, modbusClient, done)
      }, CLIENT_ACTIVE_WAIT_MS)
    })
  }

  if (server && client) {
    getPort().then((port) => {
      server.serverPort = port
      client.tcpPort = port
      load()
    }).catch(done)
  } else {
    load()
  }
}

function receiveAndWaitForDone (flexWrite, payload, done) {
  flexWrite.once('modbusFlexWriteNodeError', function () {
    done(new Error('flex write failed for payload: ' + payload))
  })
  flexWrite.once('modbusFlexWriteNodeDone', function () {
    done()
  })
  flexWrite.receive({ payload })
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
      loadFlexWriteFlow(testFlows.testWriteParametersFlow, '82fe7fe4.7b7bc8', function (flexWrite, _modbusClient, done) {
        receiveAndWaitForDone(flexWrite,
          '{ "value": true, "fc": 5, "unitid": 1, "address": 0, "quantity": 1 }',
          function () {
            receiveAndWaitForDone(flexWrite,
              '{ "value": 42, "fc": 6, "unitid": 1, "address": 0, "quantity": 1 }',
              function () {
                receiveAndWaitForDone(flexWrite,
                  '{ "value": [true, false, true, false], "fc": 15, "unitid": 1, "address": 0, "quantity": 4 }',
                  function () {
                    receiveAndWaitForDone(flexWrite,
                      '{ "value": [100, 200, 300], "fc": 16, "unitid": 1, "address": 0, "quantity": 3 }',
                      done)
                  })
              })
          })
      }, done)
    })

    it('should update status on input when showStatusActivities is enabled', function (done) {
      loadFlexWriteFlow(testFlows.testModbusFlexWriteFlow, 'dcb6fa4b3549ae4f', function (flexWrite, _modbusClient, done) {
        flexWrite.showStatusActivities = true
        receiveAndWaitForDone(flexWrite,
          '{ "value": true, "fc": 5, "unitid": 1, "address": 1, "quantity": 1 }',
          done)
      }, done)
    })
  })
})
