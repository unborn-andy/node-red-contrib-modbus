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

const fs = require('fs')
const os = require('os')
const path = require('path')

const nodeUnderTest = require('../../src/modbus-io-config.js')
const readNode = require('../../src/modbus-read.js')
const catchNode = require('@node-red/nodes/core/common/25-catch')
const injectNode = require('@node-red/nodes/core/common/20-inject')
const functionNode = require('@node-red/nodes/core/function/10-function')
const clientNode = require('../../src/modbus-client')
const serverNode = require('../../src/modbus-server')
const chai = require('chai')
const expect = chai.expect

const helper = require('node-red-node-test-helper')
helper.init(require.resolve('node-red'))

const testIoConfigNodes = [catchNode, injectNode, functionNode, clientNode, serverNode, nodeUnderTest, readNode]

describe('IO Config E2E Testing', function () {
  let tempIoFile

  before(function (done) {
    helper.startServer(function () {
      done()
    })
  })

  afterEach(function (done) {
    helper.unload().then(function () {
      done()
    }).catch(function (err) {
      done(err)
    }).finally(function () {
      if (tempIoFile && fs.existsSync(tempIoFile)) {
        try {
          fs.unlinkSync(tempIoFile)
        } catch (e) { /* ignore */ }
        tempIoFile = null
      }
    })
  })

  after(function (done) {
    helper.stopServer(function () {
      done()
    })
  })

  describe('IO Node testing', function () {
    it('should handle end of lineReader', function (done) {
      tempIoFile = path.join(os.tmpdir(), 'modbus-io-e2e-' + Date.now() + '.json')
      const line = JSON.stringify({
        name: 'iTemperature',
        valueAddress: '%IW0'
      })
      fs.writeFileSync(tempIoFile, line + '\n', 'utf8')

      const flow = [
        {
          id: 'c1d2e3f4g5h6i7',
          type: 'modbus-io-config',
          name: 'ModbusIOConfig',
          path: tempIoFile,
          format: 'utf8',
          addressOffset: ''
        }
      ]

      let settled = false
      const finish = function (err) {
        if (settled) {
          return
        }
        settled = true
        done(err)
      }

      helper.load(testIoConfigNodes, flow, function (err) {
        if (err) {
          finish(err)
          return
        }

        const configNode = helper.getNode('c1d2e3f4g5h6i7')
        if (!configNode) {
          finish(new Error('modbus-io-config node not loaded'))
          return
        }

        const onUpdated = function (configData) {
          try {
            expect(configNode.lastUpdatedAt).to.be.a('number')
            expect(configData).to.be.an('array')
            expect(configData).to.have.lengthOf(1)
            expect(configData[0]).to.deep.include({
              name: 'iTemperature',
              valueAddress: '%IW0'
            })
            finish()
          } catch (assertErr) {
            finish(assertErr)
          }
        }

        if (configNode.lastUpdatedAt != null && Array.isArray(configNode.configData) && configNode.configData.length) {
          onUpdated(configNode.configData)
          return
        }

        configNode.once('updatedConfig', onUpdated)

        setTimeout(function () {
          finish(new Error('timed out waiting for lineReader end / updatedConfig'))
        }, 3000)
      })
    })

    it('should warn and skip load when IO file is missing', function (done) {
      const missingPath = path.join(os.tmpdir(), 'modbus-io-missing-' + Date.now() + '.json')
      const flow = [
        {
          id: 'a1b2c3d4e5f6g7',
          type: 'modbus-io-config',
          name: 'MissingIO',
          path: missingPath,
          format: 'utf8',
          addressOffset: ''
        }
      ]

      helper.load(testIoConfigNodes, flow, function (err) {
        if (err) {
          done(err)
          return
        }
        try {
          const configNode = helper.getNode('a1b2c3d4e5f6g7')
          expect(configNode.lineReader).to.equal(undefined)
          expect(configNode.lastUpdatedAt).to.equal(null)
          done()
        } catch (assertErr) {
          done(assertErr)
        }
      })
    })
  })
})
