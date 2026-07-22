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

const injectNode = require('@node-red/nodes/core/common/20-inject')
const functionNode = require('@node-red/nodes/core/function/10-function')
const commentNode = require('@node-red/nodes/core/common/90-comment.js')

const modbusServerNode = require('../../src/modbus-server.js')
const modbusClientNode = require('../../src/modbus-client.js')
const modbusWriteNode = require('../../src/modbus-write.js')
const modbusResponseNode = require('../../src/modbus-response.js')

const helper = require('node-red-node-test-helper')
helper.init(require.resolve('node-red'))

const nodeList = [injectNode, functionNode, commentNode, modbusServerNode, modbusClientNode, modbusResponseNode, modbusWriteNode]

const testFlows = require('./flows/modbus-write-e2e-flows')
const {
  withEphemeralPorts,
  waitForLiveClientServer,
  waitForHelperModbusExchange,
  onceDone
} = require('../helper/test-helper-extensions')

const CI = !!process.env.CI
const SUITE_MS = CI ? 60000 : 30000

describe('Client Modbus Integration', function () {
  this.timeout(SUITE_MS)

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

  describe('Modbus Write', function () {
    it('should write Modbus via TCP and receive a write response payload', function (done) {
      const finish = onceDone(done)
      withEphemeralPorts(testFlows.testFlowWritingWithoutInject).then(function (flow) {
        helper.load(nodeList, flow, function (loadErr) {
          if (loadErr) return finish(loadErr)

          const writeNode = helper.getNode('409b03f21dcb23ad')
          const server = helper.getNode('1c02e4fb3dfc38ca')
          const client = helper.getNode('354de6bb.6c3652')
          const helperOut = helper.getNode('fb82d89fd8474fcb')

          writeNode.should.have.property('name', 'ModbusTestWrite')

          waitForLiveClientServer(server, client, function (readyErr) {
            if (readyErr) return finish(readyErr)

            waitForHelperModbusExchange(helperOut, function (exErr) {
              if (exErr) return finish(exErr)
              finish()
            }, { timeoutMessage: 'timeout waiting for Modbus write response' })

            writeNode.receive({ payload: true })
          })
        })
      }).catch(finish)
    })
  })

  describe('Posts', function () {
    it('should give status 200 site for serial ports list', function (done) {
      const finish = onceDone(done)
      withEphemeralPorts(testFlows.testFlowWriting).then(function (flow) {
        helper.load(nodeList, flow, function (loadErr) {
          if (loadErr) return finish(loadErr)
          const server = helper.getNode('1c02e4fb3dfc38ca')
          const client = helper.getNode('354de6bb.6c3652')
          waitForLiveClientServer(server, client, function (readyErr) {
            if (readyErr) return finish(readyErr)
            helper.request().get('/modbus/serial/ports').expect(200).end(finish)
          })
        })
      }).catch(finish)
    })
  })
})
