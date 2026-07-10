/**
 * Original Work Copyright 2014 IBM Corp.
 * node-red
 *
 * Copyright (c) 2022 Klaus Landsdorf (http://node-red.plus/)
 * All rights reserved.
 * node-red-contrib-modbus
 *
 **/

'use strict'

const fs = require('fs')
const path = require('path')
const { PortHelper } = require('./test-helper-port')
const portHelper = new PortHelper()

const IO_FILE_NODE_TYPES = new Set([
  'modbus-response-filter',
  'modbus-flex-getter',
  'modbus-flex-write',
  'modbus-getter',
  'modbus-read',
  'modbus-write',
  'modbus-flex-sequencer'
])

function validateFlowFixture (flow, options = {}) {
  const baseDir = options.baseDir || process.cwd()
  const errors = []
  const nodesById = new Map()

  if (!Array.isArray(flow)) {
    throw new Error('validateFlowFixture: flow must be an array')
  }

  for (const node of flow) {
    if (node && node.id) {
      nodesById.set(node.id, node)
    }
  }

  for (const node of flow) {
    if (!node || !node.type) {
      continue
    }

    if (node.type === 'modbus-io-config' && node.path) {
      const resolved = path.resolve(baseDir, node.path)
      if (fs.existsSync(resolved) && !fs.statSync(resolved).isFile()) {
        errors.push(`modbus-io-config ${node.id}: path "${node.path}" is not a file`)
      }
    }

    if (IO_FILE_NODE_TYPES.has(node.type) && node.ioFile && !nodesById.has(node.ioFile)) {
      errors.push(`${node.type} ${node.id}: ioFile "${node.ioFile}" not found in flow`)
    }
  }

  if (errors.length) {
    throw new Error('validateFlowFixture failed:\n' + errors.join('\n'))
  }

  return true
}

function deferAfterLoad (fn, done) {
  setImmediate(function () {
    fn()
    done()
  })
}

function waitForModbusClientActive (client, callback, maxWaitMs = 10000) {
  const deadline = Date.now() + maxWaitMs
  const poll = () => {
    if (client && typeof client.isActive === 'function' && client.isActive()) {
      callback()
      return
    }
    if (Date.now() >= deadline) {
      callback(new Error('Modbus client not active within ' + maxWaitMs + 'ms'))
      return
    }
    setTimeout(poll, 50)
  }
  poll()
}

module.exports = {
  fakeTimerConfig: { shouldClearNativeTimers: true },
  useFakeTimers: (timerUser) => {
    return timerUser.useFakeTimers(module.exports.fakeTimerConfig)
  },
  validateFlowFixture,
  deferAfterLoad,
  waitForModbusClientActive,
  cleanFlowPositionData: (jsonFlow) => {
    const cleanFlow = []
    // flow is an array of JSON objects with x,y,z from the Node-RED export
    jsonFlow.forEach((item, index, array) => {
      const newObject = JSON.parse(JSON.stringify(item))
      if (newObject.type === 'helper') {
        cleanFlow.push({ id: newObject.id, type: 'helper', wires: newObject.wires })
      } else {
        delete newObject.x
        delete newObject.y
        delete newObject.z
        cleanFlow.push(newObject)
      }
    })

    return cleanFlow
  },
  getPort: async () => {
    return await portHelper.getPort()
  }
}
