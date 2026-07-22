/**
 * Integration: 32 UnitIds × 100 own messages over one TCP Modbus-Server.
 *
 * Modbus TCP multiplexes UnitIds on a single listener — 32 servers are not
 * required. jsmodbus shares one register map, so each UnitId owns holding[U-1].
 * Messages are stamped (_unitOwn/_seq/_token) and marker-checked for ownership;
 * we assert counts, evenness, and throughput under parallelUnitIdsAllowed.
 */

'use strict'

const assert = require('assert')
const catchNode = require('@node-red/nodes/core/common/25-catch')
const injectNode = require('@node-red/nodes/core/common/20-inject')
const clientNode = require('../../src/modbus-client.js')
const serverNode = require('../../src/modbus-server.js')
const flexGetterNode = require('../../src/modbus-flex-getter.js')
const flexWriteNode = require('../../src/modbus-flex-write.js')

const helper = require('node-red-node-test-helper')
helper.init(require.resolve('node-red'))

const flows = require('./flows/modbus-unit32-load-flows')
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
  flexWriteNode
]

const CI = !!process.env.CI
const SUITE_MS = CI ? 180000 : 120000
const CLIENT_WAIT_MS = CI ? 30000 : 15000
const SERVER_WAIT_MS = CI ? 15000 : 5000
const BURST_WAIT_MS = CI ? 120000 : 90000

const UNIT_COUNT = 32
const MSGS_PER_UNIT = 100
const TOTAL_MSGS = UNIT_COUNT * MSGS_PER_UNIT

/** Marker written to holding[unitId-1] — unique address per UnitId on shared server memory */
function unitMarker (unitId) {
  return unitId * 1000
}

function unitAddress (unitId) {
  return unitId - 1
}

/** Soft floor: CI runners are slower */
const MIN_MSGS_PER_SEC = CI ? 20 : 40

/**
 * Evenness: slowest unit may finish at most this factor later than the fastest
 * (relative to total burst duration). Local stricter than CI.
 */
const MAX_FINISH_SPREAD_RATIO = CI ? 0.85 : 0.65

function onceDone (done) {
  let settled = false
  return function (err) {
    if (settled) return
    settled = true
    done(err)
  }
}

function prepareFlow (template, port) {
  const flow = JSON.parse(JSON.stringify(template))
  for (const node of flow) {
    if (!node) continue
    if (node.type === 'modbus-server') {
      node.serverPort = port
      node.responseDelay = CI ? 2 : 1
    }
    if (node.type === 'modbus-client') {
      node.tcpPort = port
      node.clientTimeout = CI ? 10000 : 8000
      node.commandDelay = CI ? 2 : 1
      node.parallelUnitIdsAllowed = true
      node.maxQueueDepth = 10000
    }
  }
  validateFlowFixture(flow)
  return flow
}

function loadFlow (cb) {
  getPort().then((port) => {
    const flow = prepareFlow(flows.unit32LoadFlow, port)
    helper.load(nodes, flow, function (err) {
      if (err) return cb(err)
      const server = helper.getNode('serverU32')
      const client = helper.getNode('clientU32')
      waitForModbusServerListening(server, function (sErr) {
        if (sErr) return cb(sErr)
        waitForModbusClientActive(client, function (cErr) {
          if (cErr) return cb(cErr)
          cb(null, { server, client, port })
        }, CLIENT_WAIT_MS)
      }, SERVER_WAIT_MS)
    })
  }).catch(cb)
}

/**
 * Seed holding[unitId-1] for each UnitId with a unique marker.
 * (jsmodbus uses one shared register map — UnitIds share memory; addresses isolate.)
 */
function seedUnitMarkers (flexWrite, helperWrite, callback) {
  let done = 0
  const timer = setTimeout(function () {
    callback(new Error('timeout seeding unit markers done=' + done + '/' + UNIT_COUNT))
  }, CI ? 60000 : 30000)

  helperWrite.on('input', function onSeed () {
    done++
    if (done >= UNIT_COUNT) {
      clearTimeout(timer)
      helperWrite.removeListener('input', onSeed)
      callback()
    }
  })

  for (let unitId = 1; unitId <= UNIT_COUNT; unitId++) {
    flexWrite.receive({
      payload: {
        fc: 6,
        unitid: unitId,
        address: unitAddress(unitId),
        quantity: 1,
        value: unitMarker(unitId)
      }
    })
  }
}

/**
 * Fire MSGS_PER_UNIT reads per UnitId with bounded in-flight window (continuous traffic).
 * Round-robin scheduling keeps UnitIds interleaved for fairness under parallelUnitIdsAllowed.
 */
function runOwnedBurst (flexGet, helperGet, helperErr, callback) {
  const perUnit = {}
  const seenSeq = {}
  const finishAt = {}
  for (let u = 1; u <= UNIT_COUNT; u++) {
    perUnit[u] = 0
    seenSeq[u] = new Set()
  }

  let completed = 0
  let sent = 0
  let errCount = 0
  let settled = false
  let inflight = 0
  const maxInflight = UNIT_COUNT * 2 // keep ~2 outstanding per UnitId
  const start = Date.now()

  // Pre-build round-robin schedule: [u1s0, u2s0, … u32s0, u1s1, …]
  const schedule = []
  for (let seq = 0; seq < MSGS_PER_UNIT; seq++) {
    for (let unitId = 1; unitId <= UNIT_COUNT; unitId++) {
      schedule.push({ unitId, seq })
    }
  }

  const timer = setTimeout(function () {
    if (settled) return
    settled = true
    cleanup()
    callback(new Error(
      'burst timeout after ' + BURST_WAIT_MS + 'ms completed=' + completed +
      '/' + TOTAL_MSGS + ' sent=' + sent + ' inflight=' + inflight +
      ' perUnit=' + JSON.stringify(perUnit)
    ))
  }, BURST_WAIT_MS)

  function cleanup () {
    helperGet.removeListener('input', onOk)
    helperErr.removeListener('input', onErr)
  }

  function pump () {
    if (settled) return
    while (inflight < maxInflight && sent < schedule.length) {
      const item = schedule[sent++]
      inflight++
      flexGet.receive({
        _unitOwn: item.unitId,
        _seq: item.seq,
        _token: 'u' + item.unitId + '-' + item.seq,
        payload: {
          fc: 3,
          unitid: item.unitId,
          address: unitAddress(item.unitId),
          quantity: 1
        }
      })
    }
  }

  function onErr (msg) {
    // Second flex-getter output is also the raw success channel — only real failures
    if (!(msg && msg.error)) return
    errCount++
    inflight = Math.max(0, inflight - 1)
    if (!settled) pump()
  }

  function onOk (msg) {
    if (settled) return
    inflight = Math.max(0, inflight - 1)
    try {
      const unitId = msg._unitOwn
      const seq = msg._seq
      const token = msg._token

      assert.ok(unitId >= 1 && unitId <= UNIT_COUNT, 'invalid _unitOwn=' + unitId)
      assert.strictEqual(typeof seq, 'number')
      assert.strictEqual(token, 'u' + unitId + '-' + seq)

      assert.ok(Array.isArray(msg.payload), 'payload should be register array')
      assert.strictEqual(
        msg.payload[0],
        unitMarker(unitId),
        'UnitId ' + unitId + ' got foreign marker ' + msg.payload[0] +
        ' (expected own register @' + unitAddress(unitId) + ')'
      )

      if (seenSeq[unitId].has(seq)) {
        throw new Error('duplicate seq ' + seq + ' for unit ' + unitId)
      }
      seenSeq[unitId].add(seq)
      perUnit[unitId]++
      completed++
      if (perUnit[unitId] === MSGS_PER_UNIT) {
        finishAt[unitId] = Date.now()
      }

      if (completed >= TOTAL_MSGS) {
        settled = true
        clearTimeout(timer)
        cleanup()
        const elapsedMs = Date.now() - start
        const finishTimes = Object.keys(finishAt).map(function (k) { return finishAt[k] })
        const minFinish = Math.min.apply(null, finishTimes)
        const maxFinish = Math.max.apply(null, finishTimes)
        callback(null, {
          completed,
          errCount,
          elapsedMs,
          msgsPerSec: completed / (elapsedMs / 1000),
          perUnit,
          finishAt,
          finishSpreadMs: maxFinish - minFinish,
          finishSpreadRatio: elapsedMs > 0 ? (maxFinish - minFinish) / elapsedMs : 0
        })
        return
      }

      pump()
    } catch (e) {
      settled = true
      clearTimeout(timer)
      cleanup()
      callback(e)
    }
  }

  helperGet.on('input', onOk)
  helperErr.on('input', onErr)
  pump()
}

describe('Integration 32 UnitIds × 100 owned messages (TCP throughput)', function () {
  this.timeout(SUITE_MS)

  before(function (done) {
    helper.startServer(done)
  })

  afterEach(function (done) {
    helper.unload().then(function () { done() }).catch(done)
  })

  after(function (done) {
    helper.stopServer(done)
  })

  it('delivers 100 unique messages per UnitId evenly and reports msgs/s', function (done) {
    const finish = onceDone(done)

    loadFlow(function (err, ctx) {
      if (err) return finish(err)
      assert.strictEqual(ctx.client.parallelUnitIdsAllowed, true)

      const flexWrite = helper.getNode('flexWriteU32')
      const flexGet = helper.getNode('flexGetU32')
      const helperWrite = helper.getNode('helperWriteU32')
      const helperGet = helper.getNode('helperGetU32')
      const helperErr = helper.getNode('helperGetErrU32')

      seedUnitMarkers(flexWrite, helperWrite, function (seedErr) {
        if (seedErr) return finish(seedErr)

        runOwnedBurst(flexGet, helperGet, helperErr, function (burstErr, stats) {
          if (burstErr) return finish(burstErr)
          try {
            measure('unit32.load', {
              units: UNIT_COUNT,
              each: MSGS_PER_UNIT,
              completed: stats.completed,
              elapsedMs: stats.elapsedMs,
              msgsPerSec: Number(stats.msgsPerSec.toFixed(1)),
              finishSpreadMs: stats.finishSpreadMs,
              finishSpreadRatio: Number(stats.finishSpreadRatio.toFixed(3)),
              errors: stats.errCount
            })

            assert.strictEqual(stats.completed, TOTAL_MSGS)
            assert.strictEqual(stats.errCount, 0, 'unexpected getter errors: ' + stats.errCount)

            for (let u = 1; u <= UNIT_COUNT; u++) {
              assert.strictEqual(
                stats.perUnit[u],
                MSGS_PER_UNIT,
                'unit ' + u + ' count=' + stats.perUnit[u]
              )
            }

            assert.ok(
              stats.msgsPerSec >= MIN_MSGS_PER_SEC,
              'throughput too low: ' + stats.msgsPerSec.toFixed(1) +
              ' msgs/s (min ' + MIN_MSGS_PER_SEC + ')'
            )

            assert.ok(
              stats.finishSpreadRatio <= MAX_FINISH_SPREAD_RATIO,
              'uneven finish spread: ratio=' + stats.finishSpreadRatio.toFixed(3) +
              ' (max ' + MAX_FINISH_SPREAD_RATIO + ') spreadMs=' + stats.finishSpreadMs
            )

            finish()
          } catch (e) {
            finish(e)
          }
        })
      })
    })
  })
})
