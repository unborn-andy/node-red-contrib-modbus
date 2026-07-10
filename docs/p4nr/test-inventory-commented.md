# Test inventory — commented / deferred blocks (mj era)

Triage of formerly commented `it()` blocks from the branch-coverage push (author `mj`).

| Decision | Count | Action |
|----------|-------|--------|
| DELETE | 6 | Removed — duplicate or wrong node/fixture |
| SKIP | 26 | `it.skip('… #test-debt-e2e')` — needs port/server E2E repair |

## DELETE (removed, covered elsewhere)

| File | Former test | Reason |
|------|-------------|--------|
| `test/core/modbus-client-core-test.js` | activateSendingOnSuccess client ID 0 (commented) | Active test exists in same file |
| `test/units/modbus-client-test.js` | 4× legacy read/active flows (commented describe) | Superseded by current client/FSM tests |
| `test/units/modbus-response-filter-test.js` | inactive if message not allowed | Wrong node type (client vs filter) |

## SKIP (#test-debt-e2e)

Deferred integration flows — require dynamic port wiring and stable server boot; track under `#test-debt-e2e`.

| File | Skipped title |
|------|----------------|
| `modbus-read-test.js` | 4× simple Node message / IO flows |
| `modbus-getter-test.js` | 6× inject / IO / queueing flows |
| `modbus-flex-write-test.js` | 5× inject / HTTP string write flows |
| `modbus-write-test.js` | 1× string true http inject flow |
| `modbus-queue-info-test.js` | 3× queue / inject flows |
| `modbus-server-test.js` | 1× server init error status |
| `modbus-flex-sequencer-test.js` | 4× load / queueing / invalid payload |
| `modbus-flex-sequencer-e2e-test.js` | 1× error in input processing |
| `modbus-client-test.js` | 1× loaded with wrong TCP |
