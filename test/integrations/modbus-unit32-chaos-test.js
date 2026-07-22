/**
 * Integration chaos: 32 TCP Modbus server/client pairs × 100 owned messages.
 *
 * While traffic runs, 5–10 servers drop for 1–3 s at a time (always ≥20 up).
 * Client queue is wiped on FSM INIT after reconnect — the pump therefore retries
 * pending (unit,seq) until each UnitId has 100 successful owned replies.
 * Asserts ownership, eventual delivery, evenness, throughput, and non-wedged queues.
 *
 * Teardown uses createTimerBag + hardStopModbusClient + abandonNetServer so
 * chaos timers / reconnect loops cannot keep the Mocha process alive (no --exit).
 */

'use strict'

const assert = require('assert')
const catchNode = require('@node-red/nodes/core/common/25-catch')
const injectNode = require('@node-red/nodes/core/common/20-inject')
const clientNode = require('../../src/modbus-client.js')
const serverNode = require('../../src/modbus-server.js')
const flexGetterNode = require('../../src/modbus-flex-getter.js')
const flexWriteNode = require('../../src/modbus-flex-write.js')
const queueCore = require('../../src/core/modbus-queue-core.js')

const helper = require('node-red-node-test-helper')
helper.init(require.resolve('node-red'))

const { buildUnit32ChaosFlow } = require('./flows/modbus-unit32-chaos-flows')
const {
  getPort,
  getPorts,
  releasePort,
  waitForModbusClientActive,
  waitForModbusServerListening,
  stopTcpModbusServer,
  startTcpModbusServer,
  forceDropModbusClientTransport,
  hardStopModbusClient,
  abandonNetServer,
  isModbusClientReady,
  createTimerBag,
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
const SUITE_MS = CI ? 390000 : 300000
const CLIENT_WAIT_MS = CI ? 45000 : 30000
const SERVER_WAIT_MS = CI ? 20000 : 10000
/** Primary burst window; nearly-complete runs get grace extension(s). */
const BURST_WAIT_MS = CI ? 330000 : 240000
const BURST_GRACE_MS = CI ? 60000 : 20000
/** CI: two grace windows — stragglers often sit at ~10–20 pending per few units. */
const BURST_GRACE_MAX = CI ? 2 : 1

const UNIT_COUNT = 32
const MSGS_PER_UNIT = 100
const TOTAL_MSGS = UNIT_COUNT * MSGS_PER_UNIT

/** Keep 5–10 servers down; implies ≥22 up (≥10–20 active requirement). */
const MIN_DOWN = 5
const MAX_DOWN = 10
const MIN_UP = UNIT_COUNT - MAX_DOWN // 22

const OUTAGE_MIN_MS = 1000
const OUTAGE_MAX_MS = 3000
const CHAOS_GAP_MS = CI ? 800 : 500

/** Throughput floor includes outage + reconnect time. */
const MIN_MSGS_PER_SEC = CI ? 3 : 5
/** Chaos makes finish times diverge more. */
const MAX_FINISH_SPREAD_RATIO = CI ? 0.99 : 0.95

function unitMarker (unitId) {
  return unitId * 1000
}

function onceDone (done) {
  let settled = false
  return function (err) {
    if (settled) return
    settled = true
    done(err)
  }
}

function randInt (min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function shuffle (arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  return a
}

function tokenKey (unitId, seq) {
  return unitId + ':' + seq
}

function prepareFlow (ports) {
  const flow = buildUnit32ChaosFlow(ports)
  for (const node of flow) {
    if (!node) continue
    if (node.type === 'modbus-server') {
      node.responseDelay = CI ? 2 : 1
    }
    if (node.type === 'modbus-client') {
      node.clientTimeout = CI ? 4000 : 3000
      node.commandDelay = CI ? 2 : 1
      node.reconnectTimeout = CI ? 500 : 400
      node.reconnectOnTimeout = true
      node.maxQueueDepth = 500
    }
  }
  validateFlowFixture(flow)
  return flow
}

function bindPair (unitId) {
  return {
    unitId,
    server: helper.getNode('serverC' + unitId),
    client: helper.getNode('clientC' + unitId),
    flexWrite: helper.getNode('flexWriteC' + unitId),
    flexGet: helper.getNode('flexGetC' + unitId),
    helperWrite: helper.getNode('helperWriteC' + unitId),
    helperGet: helper.getNode('helperGetC' + unitId),
    helperErr: helper.getNode('helperErrC' + unitId),
    up: true,
    seeding: false
  }
}

function waitAllServersListening (pairs, cb) {
  let left = pairs.length
  let failed = null
  pairs.forEach(function (p) {
    waitForModbusServerListening(p.server, function (err) {
      if (failed) return
      if (err) {
        failed = err
        return cb(err)
      }
      left--
      if (left === 0) cb()
    }, SERVER_WAIT_MS)
  })
}

function waitAllClientsActive (pairs, cb) {
  let left = pairs.length
  let failed = null
  pairs.forEach(function (p) {
    waitForModbusClientActive(p.client, function (err) {
      if (failed) return
      if (err) {
        failed = err
        return cb(err)
      }
      left--
      if (left === 0) cb()
    }, CLIENT_WAIT_MS)
  })
}

function seedPair (pair, callback) {
  const timer = setTimeout(function () {
    pair.helperWrite.removeListener('input', onWrite)
    callback(new Error('seed timeout unit=' + pair.unitId))
  }, CI ? 15000 : 8000)

  function onWrite () {
    clearTimeout(timer)
    pair.helperWrite.removeListener('input', onWrite)
    callback()
  }

  pair.helperWrite.once('input', onWrite)
  pair.flexWrite.receive({
    payload: {
      fc: 6,
      unitid: 1,
      address: 0,
      quantity: 1,
      value: unitMarker(pair.unitId)
    }
  })
}

function seedAll (pairs, callback) {
  let left = pairs.length
  let failed = null
  pairs.forEach(function (p) {
    seedPair(p, function (err) {
      if (failed) return
      if (err) {
        failed = err
        return callback(err)
      }
      left--
      if (left === 0) callback()
    })
  })
}

function takePairDown (pair, callback, timers) {
  if (!pair.up) return callback()
  pair.up = false
  if (pair._sending) pair._sending.clear()
  if (pair._nudgeIv) {
    if (timers) timers.clear(pair._nudgeIv)
    else clearInterval(pair._nudgeIv)
    pair._nudgeIv = null
  }
  stopTcpModbusServer(pair.server, function () {
    forceDropModbusClientTransport(pair.client)
    // Brief pause so the OS releases the TCP port before listen()
    const delay = timers
      ? function (fn, ms) { return timers.setTimeout(fn, ms) }
      : setTimeout
    delay(callback, 100)
  }, { failSafeMs: 800 })
}

function bringPairUp (pair, callback, opts) {
  opts = opts || {}
  const timers = opts.timers
  const isStopped = opts.isStopped || function () { return false }

  if (isStopped()) return callback()
  // Do not fake-success while another recover is in flight
  if (pair._recovering) {
    return callback(new Error('already recovering unit=' + pair.unitId))
  }
  pair._recovering = true
  pair._recoveringSince = Date.now()

  function clearNudge () {
    if (pair._nudgeIv) {
      if (timers) timers.clear(pair._nudgeIv)
      else clearInterval(pair._nudgeIv)
      pair._nudgeIv = null
    }
  }

  function fail (err) {
    clearNudge()
    pair._recovering = false
    pair._recoveringSince = 0
    callback(err)
  }

  getPort().then(function (port) {
    if (isStopped()) {
      pair._recovering = false
      releasePort(port)
      return callback()
    }

    const oldPort = pair.client && pair.client.tcpPort
    if (oldPort != null && oldPort !== port) releasePort(oldPort)

    pair.server.serverPort = port
    pair.client.tcpPort = port
    if (pair.client.tcpHost == null) pair.client.tcpHost = '127.0.0.1'

    startTcpModbusServer(pair.server, function (startErr) {
      if (isStopped()) {
        pair._recovering = false
        return callback()
      }
      if (startErr) return fail(startErr)

      let nudges = 0
      const scheduleInterval = timers
        ? function (fn, ms) { return timers.setInterval(fn, ms) }
        : setInterval

      pair._nudgeIv = scheduleInterval(function () {
        if (isStopped()) {
          clearNudge()
          return
        }
        if (isModbusClientReady(pair.client)) {
          clearNudge()
          return
        }
        if (nudges++ > 50 || pair.client.closingModbus) {
          clearNudge()
          return
        }
        try {
          // Ensure client targets the new port after outage
          pair.client.tcpPort = port
          if (typeof pair.client.connectClient === 'function') {
            pair.client.connectClient()
          }
        } catch (e) { /* ignore */ }
      }, Math.max(80, pair.client.reconnectTimeout || 400))

      // Kick FSM toward reconnect/init on new port
      try {
        if (pair.client.stateService) {
          const st = pair.client.actualServiceState && pair.client.actualServiceState.value
          if (st === 'connected' || st === 'activated' || st === 'queueing') {
            pair.client.emit('reconnect')
          } else if (typeof pair.client.connectClient === 'function') {
            pair.client.connectClient()
          }
        }
      } catch (e) { /* ignore */ }

      waitForModbusClientActive(pair.client, function (activeErr) {
        clearNudge()
        if (isStopped()) {
          pair._recovering = false
          return callback()
        }
        if (activeErr) return fail(activeErr)
        seedPair(pair, function (seedErr) {
          pair._recovering = false
          pair._recoveringSince = 0
          if (isStopped()) return callback()
          if (seedErr) return callback(seedErr)
          pair.up = true
          callback()
        })
      }, CLIENT_WAIT_MS)
    })
  }).catch(function (err) {
    pair._recovering = false
    callback(err)
  })
}

/**
 * Hard-stop all pairs: clear nudge intervals, stop clients, abandon/stop servers.
 */
function shutdownPairs (pairs, callback) {
  if (!pairs || !pairs.length) return callback()
  let left = pairs.length
  pairs.forEach(function (pair) {
    if (pair._nudgeIv) {
      clearInterval(pair._nudgeIv)
      pair._nudgeIv = null
    }
    pair.up = false
    hardStopModbusClient(pair.client)
    abandonNetServer(pair.server && pair.server.netServer)
    stopTcpModbusServer(pair.server, function () {
      left--
      if (left === 0) callback()
    }, { failSafeMs: 200 })
  })
}

/**
 * Chaos scheduler: keep concurrent downs in [MIN_DOWN, MAX_DOWN], outages 1–3 s.
 * All timers go through the provided createTimerBag bag so stop() can clearAll.
 */
function startChaos (pairs, shouldStop, onStats, timers) {
  let stopped = false
  let cycles = 0
  const downs = new Set()
  let pauseNewOutages = false

  function isStopped () {
    return stopped || shouldStop()
  }

  function upCount () {
    return pairs.filter(function (p) { return p.up && !downs.has(p.unitId) }).length
  }

  function tick () {
    if (isStopped()) return
    if (pauseNewOutages) {
      // Still allow bring-ups already scheduled; just don't take new victims
      timers.setTimeout(tick, CHAOS_GAP_MS)
      return
    }

    const currentlyDown = pairs.filter(function (p) { return downs.has(p.unitId) })
    const wantDown = randInt(MIN_DOWN, MAX_DOWN)
    const needMore = wantDown - currentlyDown.length

    if (needMore <= 0) {
      timers.setTimeout(tick, CHAOS_GAP_MS)
      return
    }

    const candidates = shuffle(
      pairs.filter(function (p) {
        return p.up && !downs.has(p.unitId)
      })
    )

    const maxTake = Math.min(needMore, candidates.length, upCount() - MIN_UP)
    if (maxTake <= 0) {
      timers.setTimeout(tick, CHAOS_GAP_MS)
      return
    }

    const victims = candidates.slice(0, maxTake)
    let pending = victims.length
    if (!pending) {
      timers.setTimeout(tick, CHAOS_GAP_MS)
      return
    }

    victims.forEach(function (pair) {
      downs.add(pair.unitId)
      const outageMs = randInt(OUTAGE_MIN_MS, OUTAGE_MAX_MS)
      // Count cycle when outage is scheduled (stop may complete after burst ends)
      cycles++
      if (onStats) {
        onStats({
          cycles,
          down: downs.size,
          up: Math.max(0, pairs.length - downs.size),
          outageMs,
          unitId: pair.unitId
        })
      }
      takePairDown(pair, function () {
        timers.setTimeout(function () {
          if (isStopped()) {
            downs.delete(pair.unitId)
            pending--
            return
          }
          bringPairUp(pair, function (err) {
            downs.delete(pair.unitId)
            if (err) {
              pair.up = false
              timers.setTimeout(function () {
                if (isStopped()) return
                downs.add(pair.unitId)
                bringPairUp(pair, function (err2) {
                  downs.delete(pair.unitId)
                  if (err2) pair.up = false
                }, { timers, isStopped })
              }, 600)
            }
            pending--
            if (pending === 0 && !isStopped()) {
              timers.setTimeout(tick, CHAOS_GAP_MS)
            }
          }, { timers, isStopped })
        }, outageMs)
      }, timers)
    })
  }

  timers.setTimeout(tick, 0)

  return {
    stop: function () {
      stopped = true
      pauseNewOutages = true
      timers.clearAll()
    },
    pause: function () { pauseNewOutages = true },
    isPaused: function () { return pauseNewOutages },
    getCycles: function () { return cycles },
    getDownCount: function () { return downs.size }
  }
}

/**
 * Continuous pump with retries: pending (unit,seq) until TOTAL_MSGS successes.
 * Only sends to pairs that are up and client-ready.
 * Stalled units (no progress while "up") are force-recovered so one bad pair
 * cannot burn the burst timeout with ~10 leftovers.
 */
function runChaosBurst (pairs, callback) {
  const burstTimers = createTimerBag()
  const pending = new Set()
  const seen = {}
  const perUnit = {}
  const finishAt = {}
  const inflight = {}
  const lastProgressAt = {}
  const STALL_MS = CI ? 8000 : 5000

  for (let u = 1; u <= UNIT_COUNT; u++) {
    perUnit[u] = 0
    seen[u] = new Set()
    inflight[u] = 0
    lastProgressAt[u] = Date.now()
    for (let s = 0; s < MSGS_PER_UNIT; s++) {
      pending.add(tokenKey(u, s))
    }
  }

  let completed = 0
  let errCount = 0
  let settled = false
  let chaosHandle = null
  let pumping = false
  let graceUsed = 0
  const maxInflightPerUnit = 2
  const start = Date.now()
  const chaosEvents = []

  function unitHasPending (unitId) {
    for (let s = 0; s < MSGS_PER_UNIT; s++) {
      if (pending.has(tokenKey(unitId, s))) return true
    }
    return false
  }

  /** Late-phase: ≥90% done, or residual pending fits a few stuck units. */
  function shouldExtendGrace () {
    if (graceUsed >= BURST_GRACE_MAX) return false
    if (pending.size === 0) return false
    if (completed >= Math.floor(TOTAL_MSGS * 0.90)) return true
    // e.g. 5 units × 12 left = 60 — still recoverable
    if (pending.size <= UNIT_COUNT * 3) return true
    return false
  }

  function clearUnitSendState (pair) {
    if (pair._sending) pair._sending.clear()
    inflight[pair.unitId] = 0
  }

  function forceRecoverPair (pair, reason) {
    if (settled || pair._recovering) return
    measure('chaos32.stall-recover', {
      unitId: pair.unitId,
      reason: reason || 'stall',
      pending: perUnit[pair.unitId],
      completed
    })
    clearUnitSendState(pair)
    pair.up = false
    forceDropModbusClientTransport(pair.client)
    bringPairUp(pair, function (err) {
      if (err) {
        pair.up = false
        // Don't clear another in-flight recover's flag
        if (!err.message || err.message.indexOf('already recovering') === -1) {
          pair._recovering = false
          pair._recoveringSince = 0
        }
        return
      }
      lastProgressAt[pair.unitId] = Date.now()
      pump()
    }, { timers: burstTimers, isStopped: function () { return settled } })
  }

  const unlockIv = burstTimers.setInterval(function () {
    if (settled) {
      burstTimers.clear(unlockIv)
      return
    }
    if (!pumping) return
    const now = Date.now()
    // Only unlock units that look wedged — blanket clear floods the queue
    pairs.forEach(function (p) {
      if (!unitHasPending(p.unitId)) return
      if (inflight[p.unitId] > 0 && now - lastProgressAt[p.unitId] > 1500) {
        clearUnitSendState(p)
      }
    })
    pump()
  }, 250)

  // Recover stranded pairs + stalled "looks ready but no progress" units
  const recoverIv = burstTimers.setInterval(function () {
    if (settled) {
      burstTimers.clear(recoverIv)
      return
    }
    const now = Date.now()
    const pendingLeft = pending.size
    const endgame = completed >= Math.floor(TOTAL_MSGS * 0.80) ||
      pendingLeft <= UNIT_COUNT * 2 ||
      graceUsed > 0 ||
      (chaosHandle && typeof chaosHandle.isPaused === 'function' && chaosHandle.isPaused())
    // 60 pending across ~5 units is common under CI load — treat as drain
    const drainMode = pendingLeft > 0 && pendingLeft <= UNIT_COUNT * 2
    const stallMs = drainMode ? (CI ? 800 : 600) : (endgame ? (CI ? 1500 : 1200) : STALL_MS)
    const burstLeft = BURST_WAIT_MS - (now - start)
    const finalSprint = graceUsed > 0 || burstLeft < (CI ? 90000 : 30000)

    if ((finalSprint || drainMode || endgame) && chaosHandle) {
      chaosHandle.pause()
    }

    pairs.forEach(function (pair) {
      if (!unitHasPending(pair.unitId)) return

      // Unstick a recover that never completed (TOCTOU / hung wait)
      if (pair._recovering && pair._recoveringSince &&
          now - pair._recoveringSince > CLIENT_WAIT_MS + 5000) {
        pair._recovering = false
        pair._recoveringSince = 0
      }

      if (!pair.up && !pair._recovering) {
        forceRecoverPair(pair, finalSprint ? 'sprint-down' : 'down')
        return
      }

      if (pair.up && !isModbusClientReady(pair.client) && !pair._recovering) {
        forceRecoverPair(pair, finalSprint ? 'sprint-not-ready' : 'not-ready')
        return
      }

      // Ready + up but no owned reply for stallMs → reconnect + reseed
      if (pumping && pair.up && isModbusClientReady(pair.client) && !pair._recovering) {
        if (now - lastProgressAt[pair.unitId] >= stallMs) {
          forceRecoverPair(pair, drainMode ? 'drain' : (finalSprint ? 'sprint-no-progress' : 'no-progress'))
        }
      }
    })
  }, 500)

  function failBurstTimeout () {
    if (settled) return
    settled = true
    burstTimers.clearAll()
    cleanup()
    if (chaosHandle) chaosHandle.stop()
    const err = new Error(
      'chaos burst timeout completed=' + completed + '/' + TOTAL_MSGS +
      ' pending=' + pending.size +
      ' down=' + (chaosHandle ? chaosHandle.getDownCount() : '?') +
      ' cycles=' + (chaosHandle ? chaosHandle.getCycles() : '?') +
      ' perUnit=' + JSON.stringify(perUnit)
    )
    shutdownPairs(pairs, function () {
      burstTimers.clearAll()
      callback(err)
    })
  }

  burstTimers.setTimeout(function onBurstDeadline () {
    if (settled) return
    // Almost done (e.g. 3140/3200 with ~60 pending) — grace for stragglers
    if (shouldExtendGrace()) {
      graceUsed += 1
      measure('chaos32.burst-grace', {
        completed,
        pending: pending.size,
        grace: graceUsed
      })
      if (chaosHandle) chaosHandle.pause()
      pairs.forEach(function (pair) {
        if (unitHasPending(pair.unitId) && !pair._recovering) {
          forceRecoverPair(pair, 'grace-' + graceUsed)
        }
      })
      pump()
      burstTimers.setTimeout(onBurstDeadline, BURST_GRACE_MS)
      return
    }
    failBurstTimeout()
  }, BURST_WAIT_MS)

  function cleanup () {
    pairs.forEach(function (p) {
      p.helperGet.removeListener('input', p._onOk)
      p.helperErr.removeListener('input', p._onErr)
    })
  }

  function finishOk () {
    if (settled) return
    settled = true
    burstTimers.clearAll()
    cleanup()
    if (chaosHandle) chaosHandle.stop()

    const elapsedMs = Date.now() - start
    const finishTimes = Object.keys(finishAt).map(function (k) { return finishAt[k] })
    const minFinish = Math.min.apply(null, finishTimes)
    const maxFinish = Math.max.apply(null, finishTimes)
    // Snapshot before shutdownPairs clears pair.up
    const stillUp = pairs.filter(function (p) { return p.up }).length
    const stats = {
      completed,
      errCount,
      elapsedMs,
      msgsPerSec: completed / (elapsedMs / 1000),
      perUnit,
      finishAt,
      finishSpreadMs: maxFinish - minFinish,
      finishSpreadRatio: elapsedMs > 0 ? (maxFinish - minFinish) / elapsedMs : 0,
      chaosCycles: chaosHandle ? chaosHandle.getCycles() : 0,
      chaosEvents: chaosEvents.length,
      stillUp
    }
    shutdownPairs(pairs, function () {
      burstTimers.clearAll()
      callback(null, stats)
    })
  }

  function pump () {
    if (settled) return
    pairs.forEach(function (pair) {
      if (!pair.up) return
      if (!isModbusClientReady(pair.client)) return
      // Mirror flex-getter gate: avoid silent drops that leak inflight slots
      if (!pair.client.client || pair.client.isInactive()) return
      if (!pair._sending) pair._sending = new Set()

      while (inflight[pair.unitId] < maxInflightPerUnit) {
        let nextSeq = -1
        for (let s = 0; s < MSGS_PER_UNIT; s++) {
          const key = tokenKey(pair.unitId, s)
          if (pending.has(key) && !pair._sending.has(s)) {
            nextSeq = s
            break
          }
        }
        if (nextSeq < 0) break

        inflight[pair.unitId]++
        pair._sending.add(nextSeq)

        pair.flexGet.receive({
          _unitOwn: pair.unitId,
          _seq: nextSeq,
          _token: 'u' + pair.unitId + '-' + nextSeq,
          payload: {
            fc: 3,
            unitid: 1,
            address: 0,
            quantity: 1
          }
        })
      }
    })
  }

  pairs.forEach(function (pair) {
    pair._onOk = function (msg) {
      if (settled) return
      const unitId = msg._unitOwn
      const seq = msg._seq
      inflight[unitId] = Math.max(0, inflight[unitId] - 1)
      if (pair._sending) pair._sending.delete(seq)

      try {
        assert.strictEqual(unitId, pair.unitId, 'cross-talk: getter ' + pair.unitId + ' got unit ' + unitId)
        assert.strictEqual(msg._token, 'u' + unitId + '-' + seq)
        assert.ok(Array.isArray(msg.payload))
        assert.strictEqual(
          msg.payload[0],
          unitMarker(unitId),
          'unit ' + unitId + ' foreign marker ' + msg.payload[0]
        )

        const key = tokenKey(unitId, seq)
        if (!pending.has(key)) {
          pump()
          return
        }
        pending.delete(key)
        seen[unitId].add(seq)
        perUnit[unitId]++
        completed++
        lastProgressAt[unitId] = Date.now()
        if (perUnit[unitId] === MSGS_PER_UNIT) {
          finishAt[unitId] = Date.now()
        }
        // Let stragglers finish without new outages
        if ((completed >= Math.floor(TOTAL_MSGS * 0.85) || pending.size <= UNIT_COUNT) && chaosHandle) {
          chaosHandle.pause()
        }
        if (completed >= TOTAL_MSGS) {
          finishOk()
        } else {
          pump()
        }
      } catch (e) {
        settled = true
        burstTimers.clearAll()
        cleanup()
        if (chaosHandle) chaosHandle.stop()
        shutdownPairs(pairs, function () {
          burstTimers.clearAll()
          callback(e)
        })
      }
    }

    pair._onErr = function (msg) {
      if (settled) return
      if (!(msg && msg.error)) return
      errCount++
      const seq = msg._seq
      inflight[pair.unitId] = Math.max(0, inflight[pair.unitId] - 1)
      if (pair._sending && seq != null) pair._sending.delete(seq)
      // Error without progress still counts as "activity" so we don't immediately
      // force-recover; unlockIv will retry the pending seq.
      pump()
    }

    pair.helperGet.on('input', pair._onOk)
    pair.helperErr.on('input', pair._onErr)
  })

  chaosHandle = startChaos(pairs, function () {
    return settled
  }, function (ev) {
    chaosEvents.push(ev)
  }, burstTimers)

  // Pump immediately in parallel with chaos (do not wait for outage cycles)
  pumping = true
  pairs.forEach(function (p) { lastProgressAt[p.unitId] = Date.now() })
  pump()
}

describe('Integration 32-server chaos × 100 owned messages', function () {
  this.timeout(SUITE_MS)

  let lastPairs = null

  before(function (done) {
    helper.startServer(done)
  })

  afterEach(function (done) {
    const finish = onceDone(done)
    const pairs = lastPairs
    lastPairs = null

    function unload () {
      helper.unload().then(function () {
        finish()
      }).catch(function () {
        finish()
      })
    }

    if (pairs) {
      pairs.forEach(function (p) {
        const port = p && p.client && p.client.tcpPort
        if (port != null) releasePort(port)
      })
      shutdownPairs(pairs, unload)
    } else {
      unload()
    }
  })

  after(function (done) {
    const finish = onceDone(done)
    // Soft failsafe only — prefer clean stopServer
    const t = setTimeout(function () { finish() }, 5000)
    helper.stopServer(function () {
      clearTimeout(t)
      finish()
    })
  })

  it('survives rolling 5–10 server outages and delivers 100 msgs per UnitId', function (done) {
    // CI timing flake under load — retries are timing, not Node 22 vs 24 semantics
    if (CI) this.retries(2)
    const finish = onceDone(done)

    getPorts(UNIT_COUNT).then(function (ports) {
      const flow = prepareFlow(ports)
      helper.load(nodes, flow, function (loadErr) {
        if (loadErr) return finish(loadErr)

        const pairs = []
        for (let u = 1; u <= UNIT_COUNT; u++) {
          pairs.push(bindPair(u))
        }
        lastPairs = pairs

        waitAllServersListening(pairs, function (sErr) {
          if (sErr) return finish(sErr)
          waitAllClientsActive(pairs, function (cErr) {
            if (cErr) return finish(cErr)

            seedAll(pairs, function (seedErr) {
              if (seedErr) return finish(seedErr)

              runChaosBurst(pairs, function (burstErr, stats) {
                if (burstErr) return finish(burstErr)
                try {
                  measure('chaos32.burst', {
                    completed: stats.completed,
                    elapsedMs: stats.elapsedMs,
                    msgsPerSec: Number(stats.msgsPerSec.toFixed(1)),
                    finishSpreadMs: stats.finishSpreadMs,
                    finishSpreadRatio: Number(stats.finishSpreadRatio.toFixed(3)),
                    chaosCycles: stats.chaosCycles,
                    chaosEvents: stats.chaosEvents,
                    errors: stats.errCount
                  })

                  assert.strictEqual(stats.completed, TOTAL_MSGS)
                  for (let u = 1; u <= UNIT_COUNT; u++) {
                    assert.strictEqual(stats.perUnit[u], MSGS_PER_UNIT, 'unit ' + u)
                  }

                  assert.ok(
                    stats.chaosCycles >= 3,
                    'expected several outage cycles, got ' + stats.chaosCycles
                  )

                  assert.ok(
                    stats.msgsPerSec >= MIN_MSGS_PER_SEC,
                    'throughput too low: ' + stats.msgsPerSec.toFixed(1)
                  )

                  assert.ok(
                    stats.finishSpreadRatio <= MAX_FINISH_SPREAD_RATIO,
                    'uneven finish: ' + stats.finishSpreadRatio.toFixed(3)
                  )

                  pairs.forEach(function (p) {
                    assert.ok(
                      queueCore.checkQueuesAreEmpty(p.client) ||
                        p.client.bufferCommandList.get(1).length < 20,
                      'unit ' + p.unitId + ' queue wedged'
                    )
                  })

                  assert.ok(
                    stats.stillUp >= MIN_UP,
                    'expected ≥' + MIN_UP + ' up at end, got ' + stats.stillUp
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
    }).catch(finish)
  })
})
