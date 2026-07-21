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

const assert = require('assert')
const coreUnderTest = require('../../src/core/modbus-core')

describe('Core Testing', function () {
  describe('Core', function () {
    describe('Core Simple', function () {
      it('should know function code number of Coil', function (done) {
        assert.strict.equal(coreUnderTest.functionCodeModbusRead('Coil'), 1)
        done()
      })

      it('should know function code number of Input', function (done) {
        assert.strict.equal(coreUnderTest.functionCodeModbusRead('Input'), 2)
        done()
      })

      it('should know function code number of HoldingRegister', function (done) {
        assert.strict.equal(coreUnderTest.functionCodeModbusRead('HoldingRegister'), 3)
        done()
      })

      it('should know function code number of InputRegister', function (done) {
        assert.strict.equal(coreUnderTest.functionCodeModbusRead('InputRegister'), 4)
        done()
      })

      it('should know give default on unknown function code name', function (done) {
        assert.strict.equal(coreUnderTest.functionCodeModbusRead('Coils'), -1)
        done()
      })

      it('should map write function codes per Modbus spec', function (done) {
        assert.strict.equal(coreUnderTest.functionCodeModbusWrite('Coil'), 5)
        assert.strict.equal(coreUnderTest.functionCodeModbusWrite('HoldingRegister'), 6)
        assert.strict.equal(coreUnderTest.functionCodeModbusWrite('MCoils'), 15)
        assert.strict.equal(coreUnderTest.functionCodeModbusWrite('MHoldingRegisters'), 16)
        assert.strict.equal(coreUnderTest.functionCodeModbusWrite('Unknown'), -1)
        done()
      })

      it('should return original msg when messageId is not in buffer map', function (done) {
        const messageList = new Map()
        const msg = { payload: { messageId: 'missing-id', value: 1 }, topic: 't' }
        const result = coreUnderTest.getOriginalMessage(messageList, msg)
        assert.strict.equal(result, msg)
        done()
      })

      it('should build dual output messages with response buffer', function (done) {
        const messageList = new Map()
        const orig = { messageId: 'abc', payload: null, topic: 'orig' }
        messageList.set('abc', orig)
        const msg = { payload: { messageId: 'abc' }, topic: 'resp' }
        const response = { address: 0, value: true }
        const values = true
        const out = coreUnderTest.buildMessage(messageList, values, response, msg)
        assert.strict.equal(out.length, 2)
        assert.strict.equal(out[0].payload, true)
        assert.strict.equal(out[0].responseBuffer, response)
        assert.strict.equal(out[1].payload, response)
        assert.strict.equal(out[1].values, true)
        done()
      })
    })
  })
})
