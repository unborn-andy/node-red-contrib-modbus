/**
 * Integration load tests: measure filtered msgs/s across 1..N UnitIds
 * through Flex-Getter → Response-Filter on a live Modbus-Server.
 */

'use strict'

const assert = require('assert')
const catchNode = require('@node-red/nodes/core/common/25-catch')
const injectNode = require('@node-red/nodes/core/common/20-inject')
const clientNode = require('../../src/modbus-client.js')
const serverNode = require('../../src/modbus-server.js')
const flexGetterNode = require('../../src/modbus-flex-getter.js')
const flexWriteNode = require('../../src/modbus-flex-write.js')
const responseFilterNode = require('../../src/modbus-response-filter.js')
const ioConfigNode = require('../../src/modbus-io-config.js')

const helper = require('node-red-node-test-helper')
helper.init(require.resolve('node-red'))

const flows = require('./flows/modbus-roundtrip-load-flows')
const {
  getPort,
  waitForModbusClientActive,
  waitForModbusServerListening,
  validateFlowFixture,
  measure
} = require('../helper/test-helper-extensions')

const nodes = [
  catchNode,
  injectNode,
  clientNode,
  serverNode,
  flexGetterNode,
  flexWriteNode,
  responseFilterNode,
  ioConfigNode
]

const CI = !!process.env.CI
const SUITE_MS = CI ? 120000 : 60000
const CLIENT_WAIT_MS = CI ? 30000 : 15000
const SERVER_WAIT_MS = CI ? 15000 : 5000
const LOAD_DURATION_MS = CI ? 2500 : 2000
/** Soft floor — CI runners are slower; local should be higher */
const MIN_MSGS_PER_SEC = CI ? 8 : 15

function onceDone (done) {
  let settled = false
  return function (err) {
    if (settled) return
    settled = true
    done(err)
  }
}

function prepareFlow (template, port, opts = {}) {
  const flow = JSON.parse(JSON.stringify(template))
  for (const node of flow) {
    if (!node) continue
    if (node.type === 'modbus-server') {
      node.serverPort = port
      node.responseDelay = opts.responseDelay != null ? opts.responseDelay : (CI ? 2 : 1)
    }
    if (node.type === 'modbus-client') {
      node.tcpPort = port
      node.clientTimeout = CI ? 8000 : 5000
      node.commandDelay = opts.commandDelay != null ? opts.commandDelay : (CI ? 5 : 1)
      if (opts.parallelUnitIdsAllowed !== undefined) {
        node.parallelUnitIdsAllowed = opts.parallelUnitIdsAllowed
      }
      node.maxQueueDepth = opts.maxQueueDepth || 5000
    }
  }
  validateFlowFixture(flow)
  return flow
}

function loadLoadFlow (opts, cb) {
  getPort().then((port) => {
    const flow = prepareFlow(flows.loadFilterFlow, port, opts)
    helper.load(nodes, flow, function (err) {
      if (err) return cb(err)
      const server = helper.getNode('serverLoad')
      const client = helper.getNode('clientLoad')
      waitForModbusServerListening(server, function (sErr) {
        if (sErr) return cb(sErr)
        waitForModbusClientActive(client, function (cErr) {
          if (cErr) return cb(cErr)
          cb(null, { client, port })
        }, CLIENT_WAIT_MS)
      }, SERVER_WAIT_MS)
    })
  }).catch(cb)
}

/**
 * Fire continuous FC3 reads across unitIds for durationMs.
 * Returns { count, elapsedMs, msgsPerSec, perUnit }
 */
function runLoadBurst (flexGet, helperOut, unitIds, durationMs, callback) {
  let count = 0
  const perUnit = {}
  unitIds.forEach((id) => { perUnit[id] = 0 })

  const onMsg = function (msg) {
    count++
    const uid = msg.payload && msg.payload[0] && msg.unitId != null
      ? msg.unitId
      : (msg.payload && msg.payload.unitid)
    // best-effort: track by round-robin index stamped on message
    if (msg._loadUnitId != null) {
      perUnit[msg._loadUnitId] = (perUnit[msg._loadUnitId] || 0) + 1
    } else if (uid != null) {
      perUnit[uid] = (perUnit[uid] || 0) + 1
    }
    assert.ok(Array.isArray(msg.payload))
    assert.strictEqual(msg.payload[0].name, 'iLoadMarker')
  }

  helperOut.on('input', onMsg)

  const start = Date.now()
  let inflight = 0
  const maxInflight = Math.max(8, unitIds.length * 4)
  let stopped = false
  let rr = 0

  function pump () {
    if (stopped) return
    while (inflight < maxInflight) {
      if (stopped) break
      const unitid = unitIds[rr % unitIds.length]
      rr++
      inflight++
      const msg = {
        _loadUnitId: unitid,
        payload: { fc: 3, unitid, address: 0, quantity: 3 }
      }
      // count completion via filter helper (already listening)
      flexGet.receive(msg)
      // approximate inflight release — filter input means one completed
      // we release on each helper message
    }
  }

  const release = function () {
    inflight = Math.max(0, inflight - 1)
    if (!stopped) pump()
  }
  helperOut.on('input', release)

  pump()

  setTimeout(function () {
    stopped = true
    const elapsedMs = Date.now() - start
    helperOut.removeListener('input', onMsg)
    helperOut.removeListener('input', release)
    const msgsPerSec = count / (elapsedMs / 1000)
    callback(null, { count, elapsedMs, msgsPerSec, perUnit, unitIds })
  }, durationMs)
}

describe('Integration Modbus load + Response-Filter (msgs/s)', function () {
  this.timeout(SUITE_MS)

  before(function (done) {
    helper.startServer(done)
  })

  afterEach(function (done) {
    helper.unload().then(() => done()).catch(done)
  })

  after(function (done) {
    helper.stopServer(done)
  })

  ;[1, 2, 4].forEach(function (nUnits) {
    it('parallel client: ≥' + MIN_MSGS_PER_SEC + ' filtered msgs/s with ' + nUnits + ' UnitId(s)', function (done) {
      const finish = onceDone(done)
      const unitIds = []
      for (let i = 1; i <= nUnits; i++) unitIds.push(i)

      loadLoadFlow({ parallelUnitIdsAllowed: true }, function (err) {
        if (err) return finish(err)

        const flexGet = helper.getNode('flexGetLoad')
        const helperLoad = helper.getNode('helperLoad')

        runLoadBurst(flexGet, helperLoad, unitIds, LOAD_DURATION_MS, function (burstErr, stats) {
          if (burstErr) return finish(burstErr)
          try {
            measure('load.parallel', {
              units: nUnits,
              count: stats.count,
              elapsedMs: stats.elapsedMs,
              msgsPerSec: Number(stats.msgsPerSec.toFixed(1)),
              perUnit: stats.perUnit
            })
            assert.ok(stats.count > 0, 'expected at least one filtered message')
            assert.ok(
              stats.msgsPerSec >= MIN_MSGS_PER_SEC,
              'throughput too low: ' + stats.msgsPerSec.toFixed(1) + ' msgs/s (min ' + MIN_MSGS_PER_SEC + ')'
            )
            finish()
          } catch (e) {
            finish(e)
          }
        })
      })
    })
  })

  it('sequential client (parallelUnitIdsAllowed=false): filtered load across 2 UnitIds without stall', function (done) {
    const finish = onceDone(done)
    const unitIds = [1, 2]
    // Sequential is slower — lower floor
    const minSeq = CI ? 3 : 5

    loadLoadFlow({ parallelUnitIdsAllowed: false, commandDelay: CI ? 10 : 2 }, function (err, ctx) {
      if (err) return finish(err)
      assert.strictEqual(ctx.client.parallelUnitIdsAllowed, false)

      const flexGet = helper.getNode('flexGetLoad')
      const helperLoad = helper.getNode('helperLoad')

      runLoadBurst(flexGet, helperLoad, unitIds, LOAD_DURATION_MS, function (burstErr, stats) {
        if (burstErr) return finish(burstErr)
        try {
          measure('load.sequential', {
            units: 2,
            count: stats.count,
            elapsedMs: stats.elapsedMs,
            msgsPerSec: Number(stats.msgsPerSec.toFixed(1)),
            perUnit: stats.perUnit
          })
          assert.ok(stats.count > 0)
          assert.ok(stats.msgsPerSec >= minSeq, 'sequential throughput too low: ' + stats.msgsPerSec.toFixed(1))
          // queues should not be wedged after burst settles
          setTimeout(function () {
            try {
              const q1 = ctx.client.bufferCommandList.get(1).length
              const q2 = ctx.client.bufferCommandList.get(2).length
              assert.ok(q1 < 50, 'unit1 queue still huge: ' + q1)
              assert.ok(q2 < 50, 'unit2 queue still huge: ' + q2)
              finish()
            } catch (e) {
              finish(e)
            }
          }, 500)
        } catch (e) {
          finish(e)
        }
      })
    })
  })
})
