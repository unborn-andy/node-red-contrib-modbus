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

const injectNode = require('@node-red/nodes/core/common/20-inject.js')
const clientNode = require('../../src/modbus-client.js')
const serverNode = require('../../src/modbus-server.js')
const nodeUnderTest = require('../../src/modbus-flex-sequencer.js')

const helper = require('node-red-node-test-helper')
helper.init(require.resolve('node-red'))
const testFlexSequencerNodes = [injectNode, clientNode, serverNode, nodeUnderTest]

const testFlows = require('./flows/modbus-flex-sequencer-e2e-flows.js')
const sinon = require('sinon')
const {
  withEphemeralPorts,
  waitForLiveClientServer,
  waitForHelperModbusExchange,
  onceDone
} = require('../helper/test-helper-extensions')

const CI = !!process.env.CI
const SUITE_MS = CI ? 60000 : 30000

describe('Flex Sequencer node Testing', function () {
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

  describe('Node', function () {
    it('should process valid sequences and exchange data with the Modbus server', function (done) {
      const finish = onceDone(done)
      withEphemeralPorts(testFlows.testNodeWithValidSequence).then(function (flow) {
        helper.load(testFlexSequencerNodes, flow, function (loadErr) {
          if (loadErr) return finish(loadErr)

          const flexSequencerNode = helper.getNode('607b91b18be2a9ee')
          const server = helper.getNode('b27f9584bc744754')
          const client = helper.getNode('92e7bf63.2efd7')
          const helperOut = helper.getNode('068602756d13ebd3')

          waitForLiveClientServer(server, client, function (readyErr) {
            if (readyErr) return finish(readyErr)

            waitForHelperModbusExchange(helperOut, function (exErr) {
              if (exErr) return finish(exErr)
              finish()
            }, {
              requireArray: true,
              timeoutMessage: 'timeout waiting for flex-sequencer Modbus response'
            })

            flexSequencerNode.receive({
              payload: {
                sequences: [
                  { unitid: 1, fc: 'FC3', address: 0, quantity: 10 }
                ]
              }
            })
          })
        })
      }).catch(finish)
    })

    it('should handle modbus read error', function (done) {
      withEphemeralPorts(testFlows.testNodeWithModbusReadError).then(function (flow) {
        helper.load(testFlexSequencerNodes, flow, () => {
          const flexSequencerNode = helper.getNode('bc5a61b6.a3972')
          const error = new Error('Test error')
          const msg = { payload: 'test payload' }
          const emitSpy = sinon.spy(flexSequencerNode, 'emit')
          flexSequencerNode.onModbusReadError(error, msg)
          sinon.assert.calledWith(emitSpy, 'modbusFlexSequencerNodeError')
          done()
        })
      }).catch(done)
    })

    it('should handle invalid payload in input message without falsely claiming TCP exchange', function (done) {
      withEphemeralPorts(testFlows.testNodeWithInvalidMessage).then(function (flow) {
        helper.load(testFlexSequencerNodes, flow, function () {
          const flexSequencerNode = helper.getNode('42c7ed2cf52e284e')
          const modbusClient = helper.getNode('92e7bf63.2efd7')
          modbusClient.isInactive = () => false
          const msg = { payload: undefined }
          flexSequencerNode.emit('input', msg)
          done()
        })
      }).catch(done)
    })
  })
})
