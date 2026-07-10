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
const expect = require('chai').expect
const testFlows = require('./flows/modbus-flex-write-flows')
const { getPort, waitForModbusClientActive } = require('../helper/test-helper-extensions')

const testNodes = [catchNode, injectNode, functionNode, clientNode, serverNode, nodeUnderTest]

function loadFlexWriteNode (flowTemplate, nodeId, callback, done) {
  const flow = Array.from(flowTemplate)
  const client = flow.find((n) => n.type === 'modbus-client')
  const server = flow.find((n) => n.type === 'modbus-server')

  const load = () => {
    helper.load(testNodes, flow, function () {
      callback(helper.getNode(nodeId), done)
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

describe('Flex Write Coverage — functional Modbus writes', function () {
  before(function (done) {
    helper.startServer(function () {
      done()
    })
  })

  afterEach(function (done) {
    helper.unload().then(function () {
      done()
    }).catch(function () {
      done()
    })
  })

  after(function (done) {
    helper.stopServer(function () {
      done()
    })
  })

  describe('functional writes against modbus-server', function () {
    function loadFlowWithPort (flowTemplate, onLoaded, done) {
      loadFlexWriteNode(flowTemplate, '82fe7fe4.7b7bc8', function (_flexWrite, done) {
        onLoaded(done)
      }, done)
    }

    it('should write single coil via FC5 and receive response', function (done) {
      this.timeout(15000)
      loadFlowWithPort(testFlows.testWriteParametersFlow, function (done) {
        const flexWrite = helper.getNode('82fe7fe4.7b7bc8')
        const modbusClient = helper.getNode('80aeec4c.0cb9e8')
        const h1 = helper.getNode('h1')
        h1.once('input', function (msg) {
          expect(msg).to.have.property('payload')
          done()
        })
        waitForModbusClientActive(modbusClient, (err) => {
          if (err) {
            done(err)
            return
          }
          flexWrite.receive({
            payload: '{ "value": true, "fc": 5, "unitid": 1, "address": 0, "quantity": 1 }'
          })
        })
      }, done)
    })

    it('should write single holding register via FC6', function (done) {
      this.timeout(15000)
      loadFlowWithPort(testFlows.testWriteParametersFlow, function (done) {
        const flexWrite = helper.getNode('82fe7fe4.7b7bc8')
        const modbusClient = helper.getNode('80aeec4c.0cb9e8')
        const h1 = helper.getNode('h1')
        h1.once('input', function (msg) {
          expect(msg).to.have.property('payload')
          done()
        })
        waitForModbusClientActive(modbusClient, (err) => {
          if (err) {
            done(err)
            return
          }
          flexWrite.receive({
            payload: '{ "value": 42, "fc": 6, "unitid": 1, "address": 0, "quantity": 1 }'
          })
        })
      }, done)
    })

    it('should write multiple coils via FC15 with matching quantity', function (done) {
      this.timeout(15000)
      loadFlowWithPort(testFlows.testWriteParametersFlow, function (done) {
        const flexWrite = helper.getNode('82fe7fe4.7b7bc8')
        const modbusClient = helper.getNode('80aeec4c.0cb9e8')
        flexWrite.once('modbusFlexWriteNodeDone', function () {
          done()
        })
        waitForModbusClientActive(modbusClient, (err) => {
          if (err) {
            done(err)
            return
          }
          flexWrite.receive({
            payload: '{ "value": [true, false, true, false], "fc": 15, "unitid": 1, "address": 0, "quantity": 4 }'
          })
        })
      }, done)
    })

    it('should write multiple holding registers via FC16', function (done) {
      this.timeout(15000)
      loadFlowWithPort(testFlows.testWriteParametersFlow, function (done) {
        const flexWrite = helper.getNode('82fe7fe4.7b7bc8')
        const modbusClient = helper.getNode('80aeec4c.0cb9e8')
        flexWrite.once('modbusFlexWriteNodeDone', function () {
          done()
        })
        waitForModbusClientActive(modbusClient, (err) => {
          if (err) {
            done(err)
            return
          }
          flexWrite.receive({
            payload: '{ "value": [100, 200, 300], "fc": 16, "unitid": 1, "address": 0, "quantity": 3 }'
          })
        })
      }, done)
    })

    it('should update status on input when showStatusActivities is enabled', function (done) {
      this.timeout(15000)
      loadFlexWriteNode(testFlows.testModbusFlexWriteFlow, 'dcb6fa4b3549ae4f', function (flexWrite, done) {
        const modbusClient = helper.getNode('80aeec4c.0cb9e8')
        flexWrite.showStatusActivities = true
        flexWrite.once('modbusFlexWriteNodeDone', function () {
          done()
        })
        waitForModbusClientActive(modbusClient, (err) => {
          if (err) {
            done(err)
            return
          }
          flexWrite.receive({
            payload: '{ "value": true, "fc": 5, "unitid": 1, "address": 1, "quantity": 1 }'
          })
        })
      }, done)
    })
  })
})
