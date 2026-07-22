/**
 * Original Work Copyright 2014 IBM Corp.
 * node-red
 *
 * Copyright (c) since the year 2016 Klaus Landsdorf (http://plus4nodered.com/)
 * All rights reserved.
 * node-red-contrib-modbus - The BSD 3-Clause License
 *
 **/

'use strict'

const nodeUnderTest = require('../../src/modbus-flex-connector.js')
const serverNode = require('../../src/modbus-server.js')
const nodeClient = require('../../src/modbus-client.js')
const injectNode = require('@node-red/nodes/core/common/20-inject.js')

const testFlexConnectorNodes = [nodeUnderTest, serverNode, nodeClient, injectNode]

const helper = require('node-red-node-test-helper')
helper.init(require.resolve('node-red'))

const testFlows = require('./flows/modbus-flex-connector-flows')
const mBasics = require('../../src/modbus-basics')
const _ = require('underscore')
const {
  getPort,
  releasePort,
  waitForModbusServerListening,
  waitForModbusClientActive,
  onceDone
} = require('../helper/test-helper-extensions')

const CI_TEST_TIMEOUT_MS = process.env.CI ? 30000 : 15000
const CLIENT_ACTIVE_WAIT_MS = process.env.CI ? 20000 : 8000
const SERVER_LISTEN_WAIT_MS = process.env.CI ? 10000 : 5000

describe('Flex Connector node Unit Testing', function () {
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

  describe('Node', function () {
    it('should be loaded', function (done) {
      helper.load(testFlexConnectorNodes, testFlows.testShouldBeLoadedFlow, function () {
        const modbusNode = helper.getNode('40ddaabb.fd44d4')
        modbusNode.should.have.property('name', 'FlexConnector')
        modbusNode.should.have.property('emptyQueue', true)
        done()
      })
    })

    it('should change the TCP-Port of the client from 7522 to 8522', function (done) {
      this.timeout(CI_TEST_TIMEOUT_MS)
      const finish = onceDone(done)
      const flow = Array.from(testFlows.testShouldChangeTcpPortFlow)
      let allocatedPort

      getPort().then((port) => {
        allocatedPort = port
        flow[1].serverPort = port
        // Client fixture stays on 7522 until Flex-Connector switches it.

        helper.load(testFlexConnectorNodes, flow, function () {
          const modbusNode = helper.getNode('40ddaabb.fd44d4')
          const clientNode = helper.getNode('2a253153.fae3ce')
          const serverNode = helper.getNode('445454e4.968564')
          modbusNode.should.have.property('name', 'FlexConnector')
          modbusNode.should.have.property('emptyQueue', true)

          waitForModbusServerListening(serverNode, function (listenErr) {
            if (listenErr) {
              if (allocatedPort) releasePort(allocatedPort)
              return finish(listenErr)
            }

            modbusNode.receive({
              payload: {
                connectorType: 'TCP',
                tcpHost: '127.0.0.1',
                tcpPort: port
              }
            })

            // dynamicReconnect applies settings synchronously before SWITCH
            Number(clientNode.tcpPort).should.equal(Number(port))

            waitForModbusClientActive(clientNode, function (activeErr) {
              if (allocatedPort) releasePort(allocatedPort)
              if (activeErr) return finish(activeErr)
              Number(clientNode.tcpPort).should.equal(Number(port))
              finish()
            }, CLIENT_ACTIVE_WAIT_MS)
          }, SERVER_LISTEN_WAIT_MS)
        })
      }).catch(finish)
    })

    it('should change the Serial-Port of the client from /dev/ttyUSB to /dev/ttyUSB0', function (done) {
      this.timeout(CI_TEST_TIMEOUT_MS)
      const finish = onceDone(done)

      helper.load(testFlexConnectorNodes, testFlows.testShouldChangeSerialPortFlow, function () {
        const modbusNode = helper.getNode('40ddaabb.fd44d4')
        const clientNode = helper.getNode('2a253153.fae3ef')
        modbusNode.should.have.property('name', 'FlexConnector')
        modbusNode.should.have.property('emptyQueue', true)

        // No real serial device in CI — assert connector applies settings sync.
        modbusNode.receive({
          payload: {
            connectorType: 'SERIAL',
            serialPort: '/dev/ttyUSB0',
            serialBaudrate: '9600'
          }
        })

        try {
          clientNode.serialPort.should.equal('/dev/ttyUSB0')
          Number(clientNode.serialBaudrate).should.equal(9600)
          finish()
        } catch (err) {
          finish(err)
        }
      })
    })

    it('should be inactive if message not allowed', function (done) {
      helper.load(testFlexConnectorNodes, testFlows.testShouldBeLoadedFlow, function () {
        const modbusClientNode = helper.getNode('2a253153.fae3ce')
        _.isUndefined(modbusClientNode).should.be.false()

        modbusClientNode.receive({ payload: 'test' })
        const isInactive = modbusClientNode.isInactive()
        isInactive.should.be.true()
        done()
      })
    })

    it('should be inactive if message empty', function (done) {
      helper.load(testFlexConnectorNodes, testFlows.testShouldBeLoadedFlow, function () {
        const modbusClientNode = helper.getNode('2a253153.fae3ce')
        setTimeout(() => {
          modbusClientNode.messageAllowedStates = ['']
          const isInactive = modbusClientNode.isInactive()
          isInactive.should.be.true()
          done()
        }, 1500)
      })
    })

    it('should be state reconnecting - not ready to send', function (done) {
      helper.load(testFlexConnectorNodes, testFlows.testShouldBeLoadedFlow, function () {
        const modbusNode = helper.getNode('40ddaabb.fd44d4')
        setTimeout(() => {
          modbusNode.statusText.should.containEql('reconnecting')
          done()
        }, 800)
      })
    })

    it('should be not state queueing - not ready to send', function (done) {
      helper.load(testFlexConnectorNodes, testFlows.testShouldBeLoadedFlow, function () {
        const modbusClientNode = helper.getNode('2a253153.fae3ce')
        setTimeout(() => {
          mBasics.setNodeStatusTo('stopped', modbusClientNode)
          const isReady = modbusClientNode.isReadyToSend(modbusClientNode)
          isReady.should.be.false()
          done()
        }, 1500)
      })
    })

    it('should process the flow as expected', function (done) {
      const flow = Array.from(testFlows.testFlowAsExpected)

      getPort().then((port) => {
        flow[1].serverPort = port
        flow[8].tcpPort = port

        helper.load(testFlexConnectorNodes, flow, function () {
          const flexNode = helper.getNode('1b4644a214cfdec6')
          if (flexNode) {
            flexNode.onConfigError(new Error('Test Error'), { payload: {} })
            done()
          }
        })
      })
    })

    it('should process the flow as expected with config msg', function (done) {
      const flow = Array.from(testFlows.testFlowAsExpectedWithConfigMessage)

      getPort().then((port) => {
        flow[1].serverPort = port
        flow[8].tcpPort = port

        helper.load(testFlexConnectorNodes, testFlows.testFlowAsExpectedWithConfigMessage, function () {
          const flexNode = helper.getNode('bf2ba5ae45aefab1')
          if (flexNode) {
            flexNode.onConfigError(new Error('Test Error'), { payload: {} })
            done()
          }
        })
      })
    })
  })

  describe('post', function () {
    it('should fail for invalid node', function (done) {
      helper.load(testFlexConnectorNodes, [], function () {
        helper.request().post('/modbus-flex-connector/invalid').expect(404).end(done)
      })
    })
  })
})
