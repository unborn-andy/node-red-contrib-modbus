'use strict'

const coreClientUnderTest = require('../../src/core/modbus-client-core')
const sinon = require('sinon')
const { useFakeTimers } = require('../helper/test-helper-extensions')

function installCoreClientSandboxHooks (context) {
  let sandbox

  context.beforeEach(function () {
    sandbox = sinon.createSandbox()
  })

  context.afterEach(function () {
    if (sandbox) {
      sandbox.restore()
      sandbox = null
    }
  })

  return function getSandbox () {
    return sandbox
  }
}

module.exports = {
  coreClientUnderTest,
  sinon,
  useFakeTimers,
  installCoreClientSandboxHooks
}
