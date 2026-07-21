# Test review checklist (PR)

Use for changes under `test/` in node-red-contrib-modbus v5 OSS.

## Behaviour

- [ ] Asserts **production code** (module under test), not local stub objects never wired in
- [ ] Test name describes observable behaviour, not line number / coverage target
- [ ] Failure would indicate a real regression

## Async / Node-RED helper

- [ ] Every `helper.load(..., callback)` test calls `done()` or returns a Promise inside the callback
- [ ] No fire-and-forget `helper.load` in sync `it()` without `done`
- [ ] Prefer `setImmediate` / events over `setTimeout(..., 800+)` when only deferring post-load work

## Sinon

- [ ] Use `sinon.createSandbox()` + `afterEach(() => sandbox.restore())` in core tests
- [ ] Do **not** assign `moduleExport.fn = sinon.stub()` — use `sandbox.stub(moduleExport, 'fn')`
- [ ] Fake timers via `useFakeTimers()` from `test/helper/test-helper-extensions.js` (`shouldClearNativeTimers: true`)

## Flow fixtures

- [ ] Run `validateFlowFixture(flow)` before `helper.load` when using exported flows
- [ ] `modbus-io-config.path` must be empty, missing, or a **file** path (never a directory like `test/`)
- [ ] Nodes with `ioFile` must reference an existing `modbus-io-config` id in the same flow

## Hygiene

- [ ] No `console.log` left in tests
- [ ] Do not comment out failing tests — fix, `it.skip('… #issue')`, or delete with justification
- [ ] No duplicate `.restore()` on the same stub

## Coverage

- [ ] Branch gaps: prefer behaviour tests over stub theatre
- [ ] User-visible changes: CHANGELOG entry
