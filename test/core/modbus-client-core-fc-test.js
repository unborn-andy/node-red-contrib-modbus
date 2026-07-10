/**
 * Original Work Copyright 2014 IBM Corp.
 * node-red-contrib-modbus - The BSD 3-Clause License
 **/
'use strict'

const assert = require('assert')
const coreClientUnderTest = require('../../src/core/modbus-client-core')
const sinon = require('sinon')
const { installCoreClientSandboxHooks } = require('./modbus-client-core-test-helper')

describe('Core Client FC Testing', function () {
  installCoreClientSandboxHooks(this)

  describe('readModbusByFunctionCode', () => {
    it('should call readModbusByFunctionCodeOne when msg.payload.fc is 1', () => {
      const node = {}
      const msg = { payload: { fc: '1' } }
      const cb = sinon.spy()
      const cberr = sinon.spy()

      sinon.stub(coreClientUnderTest, 'readModbusByFunctionCodeOne')

      coreClientUnderTest.readModbusByFunctionCode(node, msg, cb, cberr)

      sinon.assert.calledOnce(coreClientUnderTest.readModbusByFunctionCodeOne)
      sinon.assert.calledWith(coreClientUnderTest.readModbusByFunctionCodeOne, node, msg, cb, cberr)

      coreClientUnderTest.readModbusByFunctionCodeOne.restore()
    })

    it('should call readCoils_deformedReadEnabled and use the deformed path if the option is enabled', async () => {
      let isSuccess = false
      const node = {
        warn () {},
        client: {
          async readCoils_deformedReadEnabled () {
            isSuccess = true
            return 'success'
          }
        },
        activateSending: async function () {
          return 'success'
        }
      }

      const msg = { payload: { fc: '1', enableDeformedMessages: true } }
      const cb = sinon.spy()
      const cberr = sinon.spy()

      coreClientUnderTest.readModbusByFunctionCode(node, msg, cb, cberr)
      assert.equal(isSuccess, true)
    })

    it('should call read readDiscreteInputs_deformedReadEnabled and use the deformed path if the option is enabled', async () => {
      let isSuccess = false
      const node = {
        warn () {},
        client: {
          async readDiscreteInputs_deformedReadEnabled () {
            isSuccess = true
            return 'success'
          }
        },
        activateSending: async function () {
          return 'success'
        }
      }

      const msg = { payload: { fc: '2', enableDeformedMessages: true } }
      const cb = sinon.spy()
      const cberr = sinon.spy()

      coreClientUnderTest.readModbusByFunctionCode(node, msg, cb, cberr)
      assert.equal(isSuccess, true)
    })

    it('should call read readHoldingRegisters_deformedReadEnabled and use the deformed path if the option is enabled', async () => {
      let isSuccess = false
      const node = {
        warn () {},
        client: {
          async readHoldingRegisters_deformedReadEnabled () {
            isSuccess = true
            return 'success'
          }
        },
        activateSending: async function () {
          return 'success'
        }
      }

      const msg = { payload: { fc: '3', enableDeformedMessages: true } }
      const cb = sinon.spy()
      const cberr = sinon.spy()

      coreClientUnderTest.readModbusByFunctionCode(node, msg, cb, cberr)
      assert.equal(isSuccess, true)
    })

    it('should call read readInputRegisters_deformedReadEnabled and use the deformed path if the option is enabled', async () => {
      let isSuccess = false
      const node = {
        warn () {},
        client: {
          async readInputRegisters_deformedReadEnabled () {
            isSuccess = true
            return 'success'
          }
        },
        activateSending: async function () {
          return 'success'
        }
      }

      const msg = { payload: { fc: '4', enableDeformedMessages: true } }
      const cb = sinon.spy()
      const cberr = sinon.spy()

      coreClientUnderTest.readModbusByFunctionCode(node, msg, cb, cberr)
      assert.equal(isSuccess, true)
    })

    it('should handle msg.payload.fc as a string representation of a number', () => {
      const node = {}
      const msg = { payload: { fc: '2' } }
      const cb = sinon.spy()
      const cberr = sinon.spy()

      sinon.stub(coreClientUnderTest, 'readModbusByFunctionCodeTwo')

      coreClientUnderTest.readModbusByFunctionCode(node, msg, cb, cberr)

      sinon.assert.calledOnce(coreClientUnderTest.readModbusByFunctionCodeTwo)
      sinon.assert.calledWith(coreClientUnderTest.readModbusByFunctionCodeTwo, node, msg, cb, cberr)

      coreClientUnderTest.readModbusByFunctionCodeTwo.restore()
    })
    it('should call readModbusByFunctionCodeThree when msg.payload.fc is 3', () => {
      const node = {}
      const msg = { payload: { fc: '3' } }
      const cb = sinon.spy()
      const cberr = sinon.spy()

      sinon.stub(coreClientUnderTest, 'readModbusByFunctionCodeThree')

      coreClientUnderTest.readModbusByFunctionCode(node, msg, cb, cberr)

      sinon.assert.calledOnce(coreClientUnderTest.readModbusByFunctionCodeThree)
      sinon.assert.calledWith(coreClientUnderTest.readModbusByFunctionCodeThree, node, msg, cb, cberr)

      coreClientUnderTest.readModbusByFunctionCodeThree.restore()
    })
    it('should call readModbusByFunctionCodeFour when msg.payload.fc is 4', () => {
      const node = {}
      const msg = { payload: { fc: '4' } }
      const cb = sinon.spy()
      const cberr = sinon.spy()

      sinon.stub(coreClientUnderTest, 'readModbusByFunctionCodeFour')

      coreClientUnderTest.readModbusByFunctionCode(node, msg, cb, cberr)
      sinon.assert.calledWith(coreClientUnderTest.readModbusByFunctionCodeFour, node, msg, cb, cberr)
      coreClientUnderTest.readModbusByFunctionCodeFour.restore()
    })
    it('should log "Function Code Unknown" when msg.payload.fc is not 1, 2, 3, or 4', () => {
      const stubGetLogFunction = sinon.stub(coreClientUnderTest, 'getLogFunction').returns(sinon.stub())
      const stubActivateSendingOnFailure = sinon.stub(coreClientUnderTest, 'activateSendingOnFailure')
      const node = {}
      const msg = { payload: { fc: '5' } }
      const cb = sinon.spy()
      const cberr = sinon.spy()
      const nodeLog = sinon.stub().returns(null)
      stubGetLogFunction.returns(nodeLog)
      coreClientUnderTest.readModbusByFunctionCode(node, msg, cb, cberr)
      sinon.assert.calledOnce(stubActivateSendingOnFailure)
      sinon.assert.calledWithExactly(stubActivateSendingOnFailure, node, cberr, sinon.match.instanceOf(Error), msg)
      sinon.assert.calledOnceWithExactly(nodeLog, 'Function Code Unknown %s', msg.payload.fc)

      stubGetLogFunction.restore()
      stubActivateSendingOnFailure.restore()
    })
  })
  describe('writeModbusByFunctionCodeSixteen', () => {
    it('should call modbusErrorHandling when writeRegisters rejects and getID is non-zero (Task 4.7)', function (done) {
      const node = {
        client: {
          writeRegisters: sinon.stub().rejects(new Error('write error')),
          getID: sinon.stub().returns(1)
        },
        modbusErrorHandling: sinon.spy()
      }
      const activateSendingOnFailureStub = sinon.stub(coreClientUnderTest, 'activateSendingOnFailure')
      const msg = {
        payload: {
          address: '0',
          value: [1, 2, 3],
          quantity: 3
        }
      }
      const cb = sinon.spy()
      const cberr = sinon.spy()

      coreClientUnderTest.writeModbusByFunctionCodeSixteen(node, msg, cb, cberr)
      setTimeout(function () {
        sinon.assert.calledOnce(node.modbusErrorHandling)
        sinon.assert.calledOnce(activateSendingOnFailureStub)
        activateSendingOnFailureStub.restore()
        done()
      }, 50)
    })

    it('should call activateSendingOnSuccess with parsed address and value when getID returns 0', function () {
      const node = {
        client: {
          writeRegisters: sinon.stub().rejects(new Error('some error')),
          getID: sinon.stub().returns(0)
        },
        modbusErrorHandling: sinon.spy()
      }
      const msg = {
        payload: {
          address: '123',
          value: '456',
          quantity: 3
        }
      }
      const cb = sinon.spy()
      const cberr = sinon.spy()
      const coreClient = {
        activateSendingOnSuccess: sinon.spy(),
        activateSendingOnFailure: sinon.spy()
      }

      coreClientUnderTest.writeModbusByFunctionCodeSixteen(node, msg, cb, cberr)
      sinon.assert.notCalled(coreClient.activateSendingOnSuccess)
    })
    it('should call activateSendingOnSuccess when getID returns 0', function () {
      const node = {
        client: {
          writeRegisters: sinon.stub().resolves({}),
          getID: sinon.stub().returns(1)
        },
        modbusErrorHandling: sinon.spy()
      }
      const msg = {
        payload: {
          address: '123',
          value: [1, 2, 3],
          quantity: 3
        }
      }
      const cb = sinon.spy()
      const cberr = sinon.spy()
      const coreClient = {
        activateSendingOnSuccess: sinon.spy(),
        activateSendingOnFailure: sinon.spy()
      }

      coreClientUnderTest.writeModbusByFunctionCodeSixteen(node, msg, cb, cberr)

      sinon.assert.notCalled(coreClient.activateSendingOnFailure)
    })
  })
})
