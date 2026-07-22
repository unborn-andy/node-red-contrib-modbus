---
name: node-red-contrib-patterns
description: P4NR Node-RED patterns for node-red-contrib-modbus v5 Open Source. v5 LTS conventions, server node, Mocha testing, debug logging, OSS contribution rules.
---

# Node-RED Contrib Patterns — v5 OSS

`node-red-contrib-modbus` v5.x — public Open Source, LTS.

## v5 vs v6

| | v5 (this) | v6 (closed) |
|---|-----------|-------------|
| TLS | — | `Modbus-Client-TLS` |
| Server | `Modbus-Server` here | separate package |
| Log | `debug` | `winston` |
| Package | `node-red-contrib-modbus` | `@plus4nodered/...` |

## Layout

```
src/modbus-*.js, src/modbus-server.js
src/core/
modbus/          # built — do not hand-edit
test/units/, test/e2e/
```

## Testing

```javascript
const helper = require('node-red-node-test-helper')
helper.init(require.resolve('node-red'))
// require from ../../src/ — see test/units/modbus-client-test.js
```

Dynamic ports: `getPort` / `getPorts` / `withEphemeralPorts` in `test/helper/` (process-global allocator, mocha-parallel safe).
Test metrics: Winston via `measure()` — enable with `MODBUS_TEST_LOG=info` (silent by default for CI dot mode). Production logging stays `debug` (`DEBUG=contribModbus*`).

## Server Node

`Modbus-Server` uses `jsmodbus` — stays in v5 package. Spec server changes in Team 1.

## Debug

```bash
DEBUG=contribModbus* npm run test:units
```

## OSS

- StandardJS, BSD-3-Clause
- Stable public API in v5
- CHANGELOG for user-visible changes

## Commands

```bash
npm run build && npm run lint && npm test
npm run test:units
npm run mocha:base -- test/units/modbus-server-test.js
```
