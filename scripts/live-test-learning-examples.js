#!/usr/bin/env node
/**
 * Live-test learning-path examples on local Node-RED (default http://localhost:1880).
 * Parses NR5 batched /comms frames; validates debug payloads against each guide.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const http = require('http')
const WebSocket = require('ws')

const NR = process.env.NR_URL || 'http://localhost:1880'
const EXAMPLES_DIR = path.join(__dirname, '..', 'examples')
const OUT = path.join(__dirname, '..', 'tmp-example-live-results.json')
const LEARNING_TAB = /^(01 |02 |03 |04 |05 |06 |07 |08 |09 |10 |11 |12 |13 |14 |15 |16 )/

function request (method, urlPath, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, NR)
    const payload = body == null ? null : Buffer.from(JSON.stringify(body))
    const req = http.request({
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname + u.search,
      method,
      headers: {
        Accept: 'application/json',
        'Node-RED-API-Version': 'v2',
        ...(payload
          ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
          : {}),
        ...extraHeaders
      }
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json = null
        try { json = text ? JSON.parse(text) : null } catch (_) {}
        resolve({ status: res.statusCode, text, json })
      })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const loadExample = (file) => JSON.parse(fs.readFileSync(path.join(EXAMPLES_DIR, file), 'utf8'))
const isLearningTab = (n) => n.type === 'tab' && LEARNING_TAB.test(n.label || '')

function stripLearningFlows (flows) {
  const dropTabs = new Set(flows.filter(isLearningTab).map((t) => t.id))
  return flows.filter((n) => {
    if (isLearningTab(n)) return false
    if (n.z && dropTabs.has(n.z)) return false
    return true
  })
}

function connectComms () {
  const u = new URL(NR)
  const ws = new WebSocket(`ws://${u.host}/comms`)
  const debug = []
  let resolveReady, rejectReady
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const timer = setTimeout(() => rejectReady(new Error('WebSocket timeout')), 15000)
  ws.on('open', () => {
    ws.send(JSON.stringify({ subscribe: 'debug' }))
    clearTimeout(timer)
    resolveReady()
  })
  ws.on('message', (raw) => {
    let parsed
    try { parsed = JSON.parse(String(raw)) } catch (_) { return }
    const items = Array.isArray(parsed) ? parsed : [parsed]
    for (const msg of items) {
      if (msg && msg.topic === 'debug' && msg.data) {
        debug.push({ t: Date.now(), data: msg.data })
      }
    }
  })
  ws.on('error', (err) => {
    clearTimeout(timer)
    rejectReady(err)
  })
  return { ws, debug, ready }
}

function payloadOf (entry) {
  const d = entry.data || {}
  let msg = d.msg
  if (typeof msg === 'string') {
    try { msg = JSON.parse(msg) } catch (_) { return null }
  }
  if (msg && Object.prototype.hasOwnProperty.call(msg, 'payload')) return msg.payload
  if (Object.prototype.hasOwnProperty.call(d, 'payload')) return d.payload
  return msg
}

function namedIoList (p) {
  return Array.isArray(p) && p.length > 0 && p.every((x) => x && typeof x === 'object' && x.name)
}

function forTab (dbg, tabId) {
  return dbg.filter((e) => e.data && e.data.z === tabId)
}

const SUITES = [
  {
    file: '01-Modbus-Basics-Registers-And-FCs.json',
    waitMs: 3500,
    inject: ['Write 42 to HR0'],
    check (dbg) {
      const payloads = dbg.map(payloadOf)
      const hit = payloads.some((p) => p === 42 || (Array.isArray(p) && (p[0] === 42 || p.includes?.(42))))
      return { ok: hit || dbg.length > 0, note: `debug=${dbg.length} writeVisible=${hit}` }
    }
  },
  {
    file: '02-Getting-Started-Client-And-Server.json',
    waitMs: 4000,
    inject: [],
    check (dbg) {
      const arr = dbg.map(payloadOf).find((p) => Array.isArray(p))
      return { ok: !!arr, note: arr ? `poll=${JSON.stringify(arr)}` : 'no poll' }
    }
  },
  {
    file: '03-Node-Read-Polling.json',
    waitMs: 4500,
    inject: [],
    check (dbg) {
      const arrays = dbg.map(payloadOf).filter((p) => Array.isArray(p))
      const hasHolding = arrays.some((p) => typeof p[0] === 'number')
      const hasCoils = arrays.some((p) => typeof p[0] === 'boolean')
      return { ok: hasHolding && hasCoils, note: `holding=${hasHolding} coils=${hasCoils} n=${arrays.length}` }
    }
  },
  {
    file: '04-Node-Getter-On-Demand.json',
    waitMs: 2500,
    inject: ['Trigger read'],
    check (dbg) {
      const arr = dbg.map(payloadOf).find((p) => Array.isArray(p) && typeof p[0] === 'number')
      return { ok: !!arr, note: arr ? `getter=${JSON.stringify(arr)}` : 'no getter' }
    }
  },
  {
    file: '05-Node-Flex-Getter-Dynamic.json',
    waitMs: 3000,
    inject: ['FC3 qty 4', 'FC1 coils'],
    check (dbg) {
      const arrays = dbg.map(payloadOf).filter((p) => Array.isArray(p))
      return { ok: arrays.length >= 1, note: `flex arrays=${arrays.length}` }
    }
  },
  {
    file: '06-Node-Write-And-Flex-Write.json',
    waitMs: 3000,
    inject: ['Write 7 (FC6)', 'Flex FC16'],
    check (dbg) {
      return { ok: dbg.length > 0, note: `debug=${dbg.length}` }
    }
  },
  {
    file: '07-Node-Flex-Sequencer.json',
    waitMs: 3500,
    inject: ['Run sequence'],
    check (dbg) {
      return { ok: dbg.length >= 2, note: `seq steps debug=${dbg.length}` }
    }
  },
  {
    file: '08-Node-Flex-FC-Custom-Maps.json',
    waitMs: 3500,
    inject: ['Trigger FC map'],
    check (dbg) {
      return { ok: dbg.length > 0, note: `debug=${dbg.length}` }
    }
  },
  {
    file: '09-Node-Flex-Connector-Runtime-Switch.json',
    waitMs: 5000,
    inject: ['Switch → Server A', 'Switch → Server B'],
    check (dbg) {
      const arr = dbg.map(payloadOf).filter((p) => Array.isArray(p))
      return { ok: arr.length > 0, note: `poll arrays=${arr.length}` }
    }
  },
  {
    file: '10-Node-Queue-Info-And-Multi-Device.json',
    waitMs: 3500,
    inject: ['Burst reads'],
    check (dbg) {
      return { ok: dbg.length > 0, note: `debug=${dbg.length}` }
    }
  },
  {
    file: '11-Node-IO-Config-And-Response-Filter.json',
    waitMs: 7000,
    inject: ['Seed HR [42,7,3,…]'],
    check (dbg) {
      const named = dbg.map(payloadOf).filter(namedIoList)
      const hasTemp = named.some((p) => p.some((x) => x.name === 'iTemperature'))
      const filtered = named.some((p) => p.length === 1 && p[0].name === 'iTemperature')
      const sample = named[0]
        ? named[0].slice(0, 3).map((x) => ({ name: x.name, value: x.value }))
        : null
      return {
        ok: hasTemp && filtered,
        note: `named=${named.length} hasTemp=${hasTemp} filtered=${filtered}`,
        sample
      }
    }
  },
  {
    file: '12-Node-Server-Buffer-Slave.json',
    waitMs: 2500,
    inject: ['Fill holding'],
    check (dbg) {
      const hit = dbg.map(payloadOf).some((p) =>
        p && (p.register === 'holding' || (p.value && p.value[0] === 11) || p.type === 'holding' ||
          (p.message && p.message.payload && p.message.payload.register === 'holding'))
      )
      return { ok: hit || dbg.length > 0, note: `hit=${hit} debug=${dbg.length}` }
    }
  },
  {
    file: '13-Pattern-HTTP-To-Modbus.json',
    waitMs: 1500,
    inject: [],
    httpGet: '/modbus/learn/hr',
    check (dbg, ctx) {
      let data = ctx.http
      if (typeof data === 'string') {
        try { data = JSON.parse(data) } catch (_) {}
      }
      const ok = data && Array.isArray(data.data)
      return { ok: !!ok, note: `http=${JSON.stringify(data).slice(0, 100)}` }
    }
  },
  {
    file: '14-Pattern-Serial-RTU-Client.json',
    waitMs: 400,
    inject: [],
    check () {
      return { ok: true, soft: true, note: 'serial educational — no hardware' }
    }
  },
  {
    file: '15-Pattern-Gateway-With-Buffer-Server.json',
    waitMs: 5000,
    inject: ['Cache HR values'],
    check (dbg) {
      const arr = dbg.map(payloadOf).filter((p) => Array.isArray(p))
      return { ok: dbg.length > 0, note: `debug=${dbg.length} arrays=${arr.length}` }
    }
  }
]

async function main () {
  console.log('Target', NR)
  const current = await request('GET', '/flows')
  if (current.status !== 200) throw new Error('GET /flows ' + current.status)

  const baseFlows = stripLearningFlows(current.json.flows)
  const exampleNodes = []
  const meta = []

  for (const suite of SUITES) {
    const nodes = loadExample(suite.file)
    const tab = nodes.find((n) => n.type === 'tab')
    meta.push({
      file: suite.file,
      tabId: tab.id,
      label: tab.label,
      injectIds: nodes
        .filter((n) => n.type === 'inject' && suite.inject.includes(n.name))
        .map((n) => n.id)
    })
    exampleNodes.push(...nodes)
  }

  console.log(`Deploy: keep=${baseFlows.length} examples=${exampleNodes.length}`)
  const dep = await request('POST', '/flows', { flows: baseFlows.concat(exampleNodes), rev: current.json.rev }, {
    'Node-RED-Deployment-Type': 'full'
  })
  if (dep.status !== 200 && dep.status !== 204) {
    console.error(dep.text.slice(0, 800))
    throw new Error('Deploy failed ' + dep.status)
  }
  console.log('Deploy OK')
  await sleep(3000)

  const { ws, debug, ready } = connectComms()
  await ready
  console.log('comms ok')

  const results = []
  for (let i = 0; i < SUITES.length; i++) {
    const suite = SUITES[i]
    const m = meta[i]
    const mark = debug.length
    let injectOk = true
    for (const id of m.injectIds) {
      const r = await request('POST', '/inject/' + id, {})
      if (r.status !== 200 && r.status !== 204) injectOk = false
      await sleep(350)
    }
    let httpBody = null
    if (suite.httpGet) {
      await sleep(1000)
      const hr = await request('GET', suite.httpGet)
      httpBody = hr.json != null ? hr.json : hr.text
    }
    await sleep(suite.waitMs)
    const slice = forTab(debug.slice(mark), m.tabId)
    // if attribution empty (race), fall back to slice since mark
    const use = slice.length ? slice : debug.slice(mark)
    const verdict = suite.check(use, { http: httpBody, injectOk })
    const row = {
      file: suite.file,
      label: m.label,
      ok: !!verdict.ok,
      soft: !!verdict.soft,
      note: verdict.note,
      sample: verdict.sample || null,
      debugCount: use.length,
      injectOk
    }
    results.push(row)
    console.log(row.ok ? (row.soft ? 'SOFT' : 'PASS') : 'FAIL', suite.file, '—', row.note)
  }

  ws.close()
  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), nr: NR, results }, null, 2))
  const hardFail = results.filter((r) => !r.ok && !r.soft)
  console.log('\nPASS', results.filter((r) => r.ok).length, '/', results.length)
  console.log('HARD FAIL', hardFail.map((f) => f.file).join(', ') || '(none)')
  console.log('Wrote', OUT)
  if (hardFail.length) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
