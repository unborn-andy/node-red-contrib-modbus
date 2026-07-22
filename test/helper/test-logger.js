/**
 * Winston test logger for structured measurement output.
 *
 * v5 production code keeps `debug` (DEBUG=contribModbus*). Winston is
 * test-only (devDependency) so CI dot mode stays quiet by default.
 *
 * Enable measurements:
 *   MODBUS_TEST_LOG=info   npm run test:ci:heavy
 *   MODBUS_TEST_LOG=debug  npm run test:integrations
 *
 * Levels: error | warn | info | http | verbose | debug | silly
 * Default when unset / "silent": silent transport (no stdout).
 **/

'use strict'

const winston = require('winston')

const LEVELS = new Set([
  'error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly', 'silent'
])

function resolveLevel () {
  const raw = (process.env.MODBUS_TEST_LOG || process.env.LOG_LEVEL || '').toLowerCase().trim()
  if (!raw || raw === '0' || raw === 'off' || raw === 'false') return 'silent'
  if (raw === '1' || raw === 'true' || raw === 'on') return 'info'
  if (LEVELS.has(raw)) return raw
  return 'silent'
}

function createTestLogger () {
  const level = resolveLevel()
  const silent = level === 'silent'

  return winston.createLogger({
    level: silent ? 'info' : level,
    silent,
    defaultMeta: { scope: 'modbus-test' },
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.printf(function (info) {
        const { timestamp, level: lvl, message, scope, stack, ...rest } = info
        const meta = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : ''
        const base = timestamp + ' [' + lvl + '] ' + (scope || 'modbus-test') + ': ' + message + meta
        return stack ? base + '\n' + stack : base
      })
    ),
    transports: [
      new winston.transports.Console({
        stderrLevels: ['error']
      })
    ]
  })
}

const logger = createTestLogger()

/**
 * Structured measurement helper — only emits when MODBUS_TEST_LOG is enabled.
 * @param {string} name metric / event name (e.g. 'load.parallel', 'fsm.reconnect')
 * @param {object} [fields] numeric / string fields for the measurement
 */
function measure (name, fields) {
  logger.info(name, fields && typeof fields === 'object' ? fields : {})
}

module.exports = {
  logger,
  measure,
  resolveLevel,
  createTestLogger
}
