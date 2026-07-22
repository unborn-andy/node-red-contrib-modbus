/**
 * Unit checks for the global Modbus test port allocator.
 **/

'use strict'

const assert = require('assert')
const {
  getPort,
  getPorts,
  releasePort,
  releaseAllPorts,
  bindFlowToPort,
  isPortFree
} = require('../helper/test-helper-port')

describe('Global getPort allocator', function () {
  afterEach(function () {
    releaseAllPorts()
  })

  it('returns distinct free ports', async function () {
    const a = await getPort()
    const b = await getPort()
    assert.notStrictEqual(a, b)
    assert.ok(a > 0 && a < 65536)
    assert.ok(b > 0 && b < 65536)
  })

  it('getPorts allocates n unique ports', async function () {
    const ports = await getPorts(8)
    assert.strictEqual(ports.length, 8)
    assert.strictEqual(new Set(ports).size, 8)
  })

  it('OPC UA–style offset chaining advances past base', async function () {
    const base = 41000
    const p1 = await getPort(base)
    const p2 = await getPort(p1)
    assert.ok(p1 > base)
    assert.ok(p2 > p1)
  })

  it('releasePort allows the allocator to track reuse after free', async function () {
    const port = await getPort()
    releasePort(port)
    assert.strictEqual(await isPortFree(port), true)
  })

  it('bindFlowToPort sets client+server to the same port', function () {
    const flow = [
      { id: 's1', type: 'modbus-server', serverPort: 502 },
      { id: 'c1', type: 'modbus-client', tcpPort: 502 }
    ]
    bindFlowToPort(flow, 43210)
    assert.strictEqual(flow[0].serverPort, 43210)
    assert.strictEqual(flow[1].tcpPort, 43210)
  })
})
