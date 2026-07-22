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
const net = require('net')
const path = require('path')
const modbus = require('jsmodbus')
const {
  getPort: allocatePort,
  getPorts: allocatePorts,
  releasePort,
  releaseAllPorts,
  bindFlowToPort
} = require('./test-helper-port')

function serverResponseDelayMs (serverNode) {
  const rate = parseInt(serverNode && serverNode.responseDelay, 10) || 1
  switch (serverNode && serverNode.delayUnit) {
    case 'ms': return rate
    case 's': return rate * 1000
    case 'm': return rate * 60000
    case 'h': return rate * 3600000
    default: return rate
  }
}

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

function waitForModbusClientEvent (client, eventName, callback, maxWaitMs = DEFAULT_CLIENT_ACTIVE_WAIT_MS) {
  if (!client || typeof client.once !== 'function') {
    callback(new Error('waitForModbusClientEvent: invalid client'))
    return
  }
  let settled = false
  const timer = setTimeout(function () {
    if (settled) return
    settled = true
    client.removeListener(eventName, onEvent)
    const state = client.actualServiceState && client.actualServiceState.value
    callback(new Error(
      'Modbus client event "' + eventName + '" not seen within ' + maxWaitMs + 'ms (state=' + state + ')'
    ))
  }, maxWaitMs)
  function onEvent () {
    if (settled) return
    settled = true
    clearTimeout(timer)
    callback(null, Array.prototype.slice.call(arguments))
  }
  client.once(eventName, onEvent)
}

function waitForModbusClientState (client, wanted, callback, maxWaitMs = DEFAULT_CLIENT_ACTIVE_WAIT_MS) {
  const wantedList = Array.isArray(wanted) ? wanted : [wanted]
  const deadline = Date.now() + maxWaitMs
  const poll = () => {
    const state = client && client.actualServiceState && client.actualServiceState.value
    if (wantedList.indexOf(state) !== -1) {
      callback(null, state)
      return
    }
    if (Date.now() >= deadline) {
      callback(new Error(
        'Modbus client state not in [' + wantedList.join(',') + '] within ' +
        maxWaitMs + 'ms (state=' + state + ')'
      ))
      return
    }
    setTimeout(poll, 50)
  }
  poll()
}

function waitForModbusClientInactive (client, callback, maxWaitMs = DEFAULT_CLIENT_ACTIVE_WAIT_MS) {
  const deadline = Date.now() + maxWaitMs
  const poll = () => {
    if (client && typeof client.isInactive === 'function' && client.isInactive()) {
      callback(null, client.actualServiceState && client.actualServiceState.value)
      return
    }
    if (Date.now() >= deadline) {
      const state = client && client.actualServiceState && client.actualServiceState.value
      callback(new Error('Modbus client still active within ' + maxWaitMs + 'ms (state=' + state + ')'))
      return
    }
    setTimeout(poll, 50)
  }
  poll()
}

/**
 * Stop TCP Modbus-Server mid-flow (simulates device/network outage).
 * Leaves the closed `net.Server` instance on the node so Node-RED's
 * later `close` handler can still call `.close()` / `.removeAllListeners()` safely.
 * Recreate listening via startTcpModbusServer.
 */
function stopTcpModbusServer (serverNode, callback, opts) {
  const waitMs = (opts && opts.failSafeMs != null) ? opts.failSafeMs : 2000
  let settled = false
  const doneOnce = function (err) {
    if (settled) return
    settled = true
    clearTimeout(failSafe)
    callback(err)
  }
  // net.Server#close can stall if sockets linger — never block E2E forever
  const failSafe = setTimeout(function () {
    doneOnce()
  }, waitMs)

  const ns = serverNode && serverNode.netServer
  if (!ns) {
    doneOnce()
    return
  }
  if (typeof ns.closeAllConnections === 'function') {
    try {
      ns.closeAllConnections()
    } catch (e) { /* ignore */ }
  }
  try {
    // Force-drop accepted sockets when available (Node 18+)
    if (typeof ns[Symbol.for('nodejs.connectionKey')] === 'undefined' && ns._connections) {
      /* best-effort only */
    }
  } catch (e) { /* ignore */ }

  if (!ns.listening) {
    doneOnce()
    return
  }
  ns.close(function () {
    doneOnce()
  })
}

/**
 * Force-close a net.Server without blocking. Used when replacing listeners so
 * orphan servers cannot keep the Mocha process alive.
 */
function abandonNetServer (ns) {
  if (!ns) return
  try {
    if (typeof ns.closeAllConnections === 'function') {
      ns.closeAllConnections()
    }
  } catch (e) { /* ignore */ }
  try {
    if (ns.listening) {
      ns.close(function () { /* ignore */ })
    }
  } catch (e) { /* ignore */ }
  try {
    ns.removeAllListeners()
  } catch (e) { /* ignore */ }
}

/**
 * Restart TCP Modbus-Server after stopTcpModbusServer.
 * Always allocates a fresh net.Server; abandons any previous instance.
 */
function startTcpModbusServer (serverNode, callback) {
  if (!serverNode) {
    callback(new Error('startTcpModbusServer: missing server node'))
    return
  }
  if (serverNode.netServer && serverNode.netServer.listening) {
    callback()
    return
  }

  const hostname = serverNode.hostname || '127.0.0.1'
  const port = parseInt(serverNode.serverPort, 10)
  let settled = false
  const doneOnce = function (err) {
    if (settled) return
    settled = true
    callback(err)
  }

  abandonNetServer(serverNode.netServer)

  serverNode.netServer = new net.Server()
  serverNode.modbusServer = new modbus.server.TCP(serverNode.netServer, {
    logLabel: 'ModbusServer',
    logLevel: 'warn',
    logEnabled: !!serverNode.logEnabled,
    responseDelay: serverResponseDelayMs(serverNode),
    coils: Buffer.alloc(serverNode.coilsBufferSize || 8000, 0),
    holding: Buffer.alloc(serverNode.holdingBufferSize || 8000, 0),
    input: Buffer.alloc(serverNode.inputBufferSize || 8000, 0),
    discrete: Buffer.alloc(serverNode.discreteBufferSize || 8000, 0)
  })
  serverNode.modbusServer.on('connection', function (client) {
    if (client && client.socket) {
      client.socket.on('error', function () { /* swallow */ })
    }
  })
  serverNode.netServer.once('error', function (err) {
    doneOnce(err)
  })
  serverNode.netServer.listen(port, hostname, function () {
    doneOnce()
  })
}

/**
 * Drop the Modbus-Serial TCP transport so `_port` emits `close` → FSM CLOSE/reconnect.
 * Server listen() stop alone often leaves the client FSM in `connected` until the next I/O.
 */
function forceDropModbusClientTransport (clientNode) {
  if (!clientNode || !clientNode.client) return
  try {
    const port = clientNode.client._port
    if (port && port._client && typeof port._client.destroy === 'function') {
      port._client.destroy()
      return
    }
    if (port && typeof port.close === 'function') {
      port.close(function () {})
      return
    }
    if (typeof clientNode.client.close === 'function') {
      clientNode.client.close(function () {})
    }
  } catch (e) { /* ignore */ }
}

/**
 * Stop client FSM reconnect loops and drop the socket (test teardown).
 */
function hardStopModbusClient (clientNode) {
  if (!clientNode) return
  try {
    clientNode.closingModbus = true
    if (clientNode.reconnectTimeoutId) {
      clearTimeout(clientNode.reconnectTimeoutId)
      clientNode.reconnectTimeoutId = 0
    }
    if (clientNode.stateService && typeof clientNode.stateService.send === 'function') {
      clientNode.stateService.send('STOP')
    }
  } catch (e) { /* ignore */ }
  forceDropModbusClientTransport(clientNode)
}

/**
 * Track setTimeout/setInterval so chaos/tests can clearAll on shutdown
 * and the Node process can exit without mocha --exit.
 */
function createTimerBag () {
  const timers = new Set()
  return {
    setTimeout: function (fn, ms) {
      const rest = Array.prototype.slice.call(arguments, 2)
      const id = setTimeout.apply(null, [function () {
        timers.delete(id)
        fn.apply(null, rest)
      }, ms].concat(rest))
      timers.add(id)
      return id
    },
    setInterval: function (fn, ms) {
      const id = setInterval(fn, ms)
      timers.add(id)
      return id
    },
    clear: function (id) {
      clearTimeout(id)
      clearInterval(id)
      timers.delete(id)
    },
    clearAll: function () {
      timers.forEach(function (id) {
        clearTimeout(id)
        clearInterval(id)
      })
      timers.clear()
    },
    size: function () {
      return timers.size
    }
  }
}

/**
 * Full TCP outage simulation: stop server listener + drop client socket (FSM CLOSE path).
 */
function simulateTcpOutage (serverNode, clientNode, callback) {
  stopTcpModbusServer(serverNode, function (stopErr) {
    if (stopErr) return callback(stopErr)
    forceDropModbusClientTransport(clientNode)
    setTimeout(function () {
      if (clientNode && !clientNode.isInactive() && clientNode.stateService) {
        try {
          clientNode.stateService.send('BREAK')
        } catch (e) { /* ignore */ }
      }
      callback()
    }, 50)
  })
}

/**
 * Clone a flow and assign ephemeral ports to modbus-server / matching client tcpPort.
 * Safe under mocha --parallel across worker processes.
 */
function onceDone (done) {
  let settled = false
  return function (err) {
    if (settled) return
    settled = true
    done(err)
  }
}

const DEFAULT_SERVER_WAIT_MS = process.env.CI ? 15000 : 5000
const DEFAULT_CLIENT_WAIT_MS = process.env.CI ? 30000 : 15000
const DEFAULT_MSG_WAIT_MS = process.env.CI ? 20000 : 10000

/**
 * Wait until Modbus-Server is listening and Modbus-Client is active (connected).
 * Use before any receive() that expects a real TCP exchange.
 */
function waitForLiveClientServer (serverNode, clientNode, callback, options) {
  const opts = options || {}
  const serverWait = opts.serverWaitMs != null ? opts.serverWaitMs : DEFAULT_SERVER_WAIT_MS
  const clientWait = opts.clientWaitMs != null ? opts.clientWaitMs : DEFAULT_CLIENT_WAIT_MS
  waitForModbusServerListening(serverNode, function (sErr) {
    if (sErr) return callback(sErr)
    waitForModbusClientActive(clientNode, callback, clientWait)
  }, serverWait)
}

/**
 * Assert a message came from a real Modbus exchange (not an empty load-only pass).
 */
function assertLiveModbusPayload (msg, options) {
  const opts = options || {}
  const assert = require('assert')
  assert.ok(msg, 'expected Modbus message from live exchange')
  assert.ok(msg.payload != null, 'expected non-null payload from Modbus client↔server exchange')
  if (opts.requireArray) {
    assert.ok(Array.isArray(msg.payload) || (msg.payload && Array.isArray(msg.payload.data)),
      'expected array payload (or payload.data) from Modbus read')
  }
  if (opts.requireResponse !== false && msg.payload && typeof msg.payload === 'object' && !Array.isArray(msg.payload)) {
    // Write/FC responses often nest under payload.response or leave values on payload
    const hasData = msg.payload.data != null ||
      msg.payload.response != null ||
      msg.payload.value != null ||
      msg.payload.address != null ||
      Object.keys(msg.payload).length > 0
    assert.ok(hasData, 'expected Modbus response fields on payload')
  }
  return msg
}

/**
 * Wait for the first helper input with a live Modbus payload, or fail on timeout.
 */
function waitForHelperModbusExchange (helperNode, callback, options) {
  const opts = options || {}
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : DEFAULT_MSG_WAIT_MS
  const finish = onceDone(callback)
  const timer = setTimeout(function () {
    helperNode.removeListener('input', onInput)
    finish(new Error(opts.timeoutMessage || 'timeout waiting for Modbus exchange on helper'))
  }, timeoutMs)

  function onInput (msg) {
    clearTimeout(timer)
    try {
      assertLiveModbusPayload(msg, opts)
      finish(null, msg)
    } catch (err) {
      finish(err)
    }
  }

  helperNode.once('input', onInput)
}

/**
 * Disable deploy-time injects so tests control Modbus traffic explicitly.
 */
function muteAutoInjects (flow) {
  for (const node of flow) {
    if (node && node.type === 'inject') {
      node.once = false
      node.onceDelay = 0
      node.repeat = ''
      node.crontab = ''
    }
  }
  return flow
}

/**
 * Live client/server ready → send invalid input (must not throw / must not look like
 * a successful Modbus exchange unless allowSuccessOnInvalid) → then send validMsg and
 * require a real helper payload. Proves the node survived bad input and still talks TCP.
 */
function assertSurvivesInvalidThenExchanges (options, callback) {
  const opts = options || {}
  const finish = onceDone(callback)
  const settleMs = opts.settleMs != null ? opts.settleMs : 500
  const allowSuccessOnInvalid = !!opts.allowSuccessOnInvalid
  const server = opts.server
  const client = opts.client
  const node = opts.node
  const successHelper = opts.successHelper
  const invalidMsg = opts.invalidMsg
  const validMsg = opts.validMsg

  if (!server || !client || !node || !successHelper || !validMsg) {
    return finish(new Error('assertSurvivesInvalidThenExchanges: missing required options'))
  }

  waitForLiveClientServer(server, client, function (readyErr) {
    if (readyErr) return finish(readyErr)

    let sawSuccessPayload = false
    function looksLikeSuccess (msg) {
      if (!msg || msg.payload == null) return false
      const p = msg.payload
      if (Array.isArray(p)) return p.length > 0
      if (typeof p !== 'object') return false
      return p.data != null || p.response != null || p.value != null ||
        (Array.isArray(p.payload) && p.payload.length > 0)
    }
    function onInvalidPhase (msg) {
      if (!allowSuccessOnInvalid && looksLikeSuccess(msg)) {
        sawSuccessPayload = true
      }
    }
    successHelper.on('input', onInvalidPhase)

    try {
      if (invalidMsg !== undefined) node.receive(invalidMsg)
    } catch (e) {
      successHelper.removeListener('input', onInvalidPhase)
      return finish(e)
    }

    setTimeout(function () {
      successHelper.removeListener('input', onInvalidPhase)
      if (sawSuccessPayload) {
        return finish(new Error('invalid input produced a Modbus success payload'))
      }
      waitForHelperModbusExchange(successHelper, finish, {
        timeoutMs: opts.timeoutMs,
        timeoutMessage: opts.timeoutMessage ||
          'timeout waiting for valid Modbus exchange after invalid input',
        requireArray: opts.requireArray,
        requireResponse: opts.requireResponse
      })
      try {
        node.receive(validMsg)
      } catch (e) {
        finish(e)
      }
    }, settleMs)
  }, opts)
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
    if (clients.length === 0) return flow
    const port = await allocatePort()
    return bindFlowToPort(flow, port)
  }

  if (servers.length === 1) {
    const port = await allocatePort()
    return bindFlowToPort(flow, port)
  }

  const oldToNew = new Map()
  const ports = await allocatePorts(servers.length)
  for (let i = 0; i < servers.length; i++) {
    const server = servers[i]
    const oldPort = String(server.serverPort)
    const port = ports[i]
    oldToNew.set(oldPort, port)
    server.serverPort = port
  }
  for (const client of clients) {
    const mapped = oldToNew.get(String(client.tcpPort))
    if (mapped != null) {
      client.tcpPort = mapped
    } else {
      // Unmatched client → own free port (still globally tracked)
      client.tcpPort = await allocatePort()
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
  waitForModbusClientEvent,
  waitForModbusClientState,
  waitForModbusClientInactive,
  stopTcpModbusServer,
  startTcpModbusServer,
  abandonNetServer,
  forceDropModbusClientTransport,
  hardStopModbusClient,
  simulateTcpOutage,
  createTimerBag,
  onceDone,
  waitForLiveClientServer,
  assertLiveModbusPayload,
  waitForHelperModbusExchange,
  muteAutoInjects,
  assertSurvivesInvalidThenExchanges,
  withEphemeralPorts,
  bindFlowToPort,
  releasePort,
  releaseAllPorts,
  isModbusClientReady,
  measure: require('./test-logger').measure,
  testLogger: require('./test-logger').logger,
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
  getPort: async (portOffset) => {
    return allocatePort(portOffset)
  },
  getPorts: async (n) => {
    return allocatePorts(n)
  }
}
