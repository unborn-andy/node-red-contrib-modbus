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

const DEFAULT_CLIENT_ACTIVE_WAIT_MS = process.env.CI ? 35000 : 10000

function isModbusClientReady (client) {
  if (!client || typeof client.isActive !== 'function' || !client.isActive()) {
    return false
  }
  if (!client.client) {
    return false
  }
  if (typeof client.client.isOpen === 'boolean' && !client.client.isOpen) {
    return false
  }
  return true
}

function waitForModbusClientActive (client, callback, maxWaitMs = DEFAULT_CLIENT_ACTIVE_WAIT_MS) {
  const deadline = Date.now() + maxWaitMs
  const poll = () => {
    if (isModbusClientReady(client)) {
      callback()
      return
    }
    if (Date.now() >= deadline) {
      const state = client && client.actualServiceState && client.actualServiceState.value
      callback(new Error(
        'Modbus client not ready within ' + maxWaitMs + 'ms' +
        ' (state=' + state + ', hasClient=' + !!(client && client.client) + ')'
      ))
      return
    }
    setTimeout(poll, 100)
  }
  poll()
}

function waitForModbusServerListening (serverNode, callback, maxWaitMs = DEFAULT_CLIENT_ACTIVE_WAIT_MS) {
  const deadline = Date.now() + maxWaitMs
  const poll = () => {
    if (serverNode && serverNode.netServer && serverNode.netServer.listening) {
      callback()
      return
    }
    if (Date.now() >= deadline) {
      callback(new Error(
        'Modbus server not listening within ' + maxWaitMs + 'ms' +
        ' (hasNetServer=' + !!(serverNode && serverNode.netServer) +
        ', listening=' + !!(serverNode && serverNode.netServer && serverNode.netServer.listening) + ')'
      ))
      return
    }
    setTimeout(poll, 50)
  }
  poll()
}

/**
 * Clone a flow and assign ephemeral ports to modbus-server / matching client tcpPort.
 * Safe under mocha --parallel across worker processes.
 */
async function withEphemeralPorts (flowTemplate) {
  const flow = JSON.parse(JSON.stringify(flowTemplate))
  const servers = flow.filter((n) => n && n.type === 'modbus-server')
  const clients = flow.filter((n) => n && n.type === 'modbus-client')

  if (servers.length === 0) {
    return flow
  }

  if (servers.length === 1) {
    const port = await portHelper.getPort()
    servers[0].serverPort = port
    for (const client of clients) {
      client.tcpPort = port
    }
    return flow
  }

  const oldToNew = new Map()
  for (const server of servers) {
    const oldPort = String(server.serverPort)
    const port = await portHelper.getPort()
    oldToNew.set(oldPort, port)
    server.serverPort = port
  }
  for (const client of clients) {
    const mapped = oldToNew.get(String(client.tcpPort))
    if (mapped != null) {
      client.tcpPort = mapped
    }
  }
  return flow
}

module.exports = {
  fakeTimerConfig: { shouldClearNativeTimers: true },
  useFakeTimers: (timerUser) => {
    return timerUser.useFakeTimers(module.exports.fakeTimerConfig)
  },
  validateFlowFixture,
  deferAfterLoad,
  waitForModbusClientActive,
  waitForModbusServerListening,
  withEphemeralPorts,
  isModbusClientReady,
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
