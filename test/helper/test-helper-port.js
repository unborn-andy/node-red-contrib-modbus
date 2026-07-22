/**
 * Global TCP port allocator for mocha tests (OPC UA–style getPort, OS-safe).
 *
 * Every call returns a fresh free port for Modbus client+server fixtures.
 * Uses listen(0) so mocha --parallel workers cannot collide on a shared range.
 * Issued ports are tracked on `global` so the same process never re-issues a
 * port still marked in use (call releasePort / releaseAllPorts after teardown).
 **/

'use strict'

const net = require('net')
const address = require('address')
const core = require('../../src/core/modbus-core')

const GLOBAL_KEY = '__nrcmPortAllocator'

function getAllocatorState () {
  if (!global[GLOBAL_KEY]) {
    global[GLOBAL_KEY] = {
      used: new Set(),
      list: [],
      lastPort: 0
    }
  }
  // Back-compat for older helpers that read global.portList
  if (!global.portList) {
    global.portList = global[GLOBAL_KEY].list
  }
  return global[GLOBAL_KEY]
}

/**
 * Probe whether a concrete port is free on 127.0.0.1 (async, no racey sync check).
 */
function isPortFree (port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}

/**
 * Allocate one free TCP port (worker-safe under mocha --parallel).
 * Optional `portOffset` mirrors OPC UA chaining: skip/advance past a known base.
 *
 * @param {number} [portOffset]
 * @returns {Promise<number>}
 */
function getPort (portOffset) {
  const state = getAllocatorState()

  if (portOffset != null && Number.isFinite(Number(portOffset)) && Number(portOffset) > 0) {
    return getPortFromOffset(Number(portOffset), state)
  }

  return getEphemeralPort(state)
}

function getEphemeralPort (state) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const server = net.createServer()
      server.once('error', (err) => {
        try { server.close() } catch (e) { /* ignore */ }
        reject(err)
      })
      server.listen(0, '127.0.0.1', () => {
        let port
        try {
          port = server.address().port
        } catch (err) {
          server.close()
          reject(err)
          return
        }
        server.close((closeErr) => {
          if (closeErr) {
            reject(closeErr)
            return
          }
          if (state.used.has(port)) {
            // OS recycled a port we still track — try again
            attempt()
            return
          }
          state.used.add(port)
          state.list.push(port)
          state.lastPort = port
          global.portList = state.list
          resolve(port)
        })
      })
    }
    attempt()
  })
}

/**
 * OPC UA–style sequential scan from an offset until a free, unused port is found.
 */
async function getPortFromOffset (portOffset, state) {
  let candidate = Math.max(1, Math.floor(portOffset))
  const maxAttempts = 5000
  for (let i = 0; i < maxAttempts; i++) {
    candidate++
    if (state.used.has(candidate)) continue
    if (candidate > 65534) candidate = 20000
    const free = await isPortFree(candidate)
    if (!free) continue
    state.used.add(candidate)
    state.list.push(candidate)
    state.lastPort = candidate
    global.portList = state.list
    return candidate
  }
  throw new Error('getPort: no free port found after offset ' + portOffset)
}

/**
 * Allocate n distinct free ports (e.g. 32-server chaos).
 * @param {number} n
 * @returns {Promise<number[]>}
 */
async function getPorts (n) {
  const count = Math.max(0, Math.floor(n))
  const ports = []
  for (let i = 0; i < count; i++) {
    ports.push(await getPort())
  }
  return ports
}

function releasePort (port) {
  const state = getAllocatorState()
  const p = Number(port)
  if (!Number.isFinite(p)) return
  state.used.delete(p)
}

function releaseAllPorts () {
  const state = getAllocatorState()
  state.used.clear()
  state.list.length = 0
  state.lastPort = 0
  global.portList = state.list
}

/**
 * Assign one TCP port to every modbus-server / modbus-client in a flow clone.
 * Client and server share the same port (Modbus TCP).
 */
function bindFlowToPort (flow, port) {
  for (const node of flow) {
    if (!node || !node.type) continue
    if (node.type === 'modbus-server') node.serverPort = port
    if (node.type === 'modbus-client') node.tcpPort = port
  }
  return flow
}

class PortHelper {
  startPort = 0

  getRandomArbitrary (min, max) {
    return Math.floor(Math.random() * (max - min) + min)
  }

  init (min, max) {
    this.startPort = this.getRandomArbitrary(min, max)
  }

  findPortDuplicates = async () => {
    const state = getAllocatorState()
    const list = state.list
    return list.some((element, index) => list.indexOf(element) !== index)
  }

  getPort = (portOffset) => {
    return getPort(portOffset != null ? portOffset : undefined).then((port) => {
      this.startPort = port
      return port
    })
  }

  getPorts = (n) => getPorts(n)

  releasePort = (port) => releasePort(port)

  releaseAllPorts = () => releaseAllPorts()

  tryListen (port, maxPort, hostname, callback) {
    if (typeof callback !== 'function') {
      throw new Error('callback needs to be function on try listen')
    }

    if (hostname) {
      this.listen(port, hostname, (err, realPort) => {
        if (err) {
          if (err.code === 'EADDRNOTAVAIL') {
            return callback(new Error('the ip that is not unknown on the machine'), realPort)
          }
          return this.handleError(port, maxPort, hostname, callback)
        }

        callback(null, realPort)
      })
    } else {
      this.listen(port, null, (err, realPort) => {
        if (port === 0) {
          return callback(err, realPort)
        }

        if (err) {
          return this.handleError(err, port, maxPort, hostname, callback)
        }

        this.listen(port, '0.0.0.0', (err, realPort) => {
          if (err) {
            return this.handleError(err, port, maxPort, hostname, callback)
          }

          this.listen(port, 'localhost', (err, realPort) => {
            if (err && err.code !== 'EADDRNOTAVAIL') {
              return this.handleError(err)
            }

            this.listen(port, address.ip(), (err, realPort) => {
              if (err) {
                return this.handleError(err, port, maxPort, hostname, callback)
              }

              callback(null, realPort)
            })
          })
        })
      })
    }
  }

  handleError (err, port, maxPort, hostname, callback) {
    if (typeof callback !== 'function') {
      throw new Error('callback needs to be function on handle error')
    }

    core.internalDebug('actual test port error: ' + err.message, [{ topic: 'testing port' }], err)

    port++
    if (port >= maxPort) {
      port = 0
      maxPort = 0
    }

    this.tryListen(port, maxPort, hostname, callback)
  }

  listen (port, hostname, callback) {
    if (typeof callback !== 'function') {
      throw new Error('callback needs to be function on listen')
    }
    const server = new net.Server()

    server.on('error', (err) => {
      try {
        server.close()
      } catch (e) {
        core.internalDebug('server close error: ' + err.message, [{ topic: 'testing port' }], err)
      }

      if (err.code === 'ENOTFOUND') {
        return callback(null, port)
      }

      return callback(err, port)
    })

    server.listen(port, hostname, () => {
      try {
        port = server.address().port
        server.close()
      } catch (err) {
        core.internalDebug('server close error: ' + err.message, [{ topic: 'testing port' }], err)
      }

      return callback(null, port)
    })
  }

  tearDown () {
    this.startPort = 0
    const state = getAllocatorState()
    core.internalDebug('Port List: ' + state.list, [{ topic: 'testing port list' }])
    releaseAllPorts()
  }
}

/** Process-wide shared helper (one allocator for all test files in a worker). */
function getSharedPortHelper () {
  if (!global.__nrcmSharedPortHelper) {
    global.__nrcmSharedPortHelper = new PortHelper()
  }
  return global.__nrcmSharedPortHelper
}

module.exports = {
  PortHelper,
  getSharedPortHelper,
  getPort,
  getPorts,
  releasePort,
  releaseAllPorts,
  bindFlowToPort,
  isPortFree
}
