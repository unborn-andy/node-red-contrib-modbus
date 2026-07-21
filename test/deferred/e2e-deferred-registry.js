/**
 * Deferred E2E / integration tests from mj coverage era (#test-debt-e2e).
 * Re-enable when flows use validateFlowFixture + dynamic ports consistently.
 */
'use strict'

describe('Deferred E2E tests (#test-debt-e2e)', function () {
  describe('modbus-read', function () {
    it.skip('simple Node should send message with empty topic #test-debt-e2e')
    it.skip('simple Node should send message with own topic #test-debt-e2e')
    it.skip('simple Node should send message with IO #test-debt-e2e')
    it.skip('simple Node should send message with IO and sending IO-objects as payload #test-debt-e2e')
  })

  describe('modbus-getter', function () {
    it.skip('should handle input correctly and emit readModbus event #test-debt-e2e')
    it.skip('should reset input delay timer correctly #test-debt-e2e')
    it.skip('simple flow with inject should be loaded #test-debt-e2e')
    it.skip('should work as simple flow with inject and IO #test-debt-e2e')
    it.skip('should work as simple flow with inject and IO with read done #test-debt-e2e')
    it.skip('should be not state queueing - not ready to send #test-debt-e2e')
  })

  describe('modbus-flex-write', function () {
    it.skip('simple flow with inject and write should be loaded #test-debt-e2e')
    it.skip('simple flow with string input from http should be parsed and written #test-debt-e2e')
    it.skip('simple flow with string with array of values input from http should be parsed and written #test-debt-e2e')
    it.skip('simple flow with string value true input from http should be parsed and written #test-debt-e2e')
    it.skip('simple flow with string value false input from http should be parsed and written #test-debt-e2e')
  })

  describe('modbus-write', function () {
    it.skip('simple flow with string true http inject and write should be loaded and write done #test-debt-e2e')
  })

  describe('modbus-queue-info', function () {
    it.skip('should call checkQueueStates and setNodeStatusByActivity in readFromQueue #test-debt-e2e')
    it.skip('simple flow with old reset inject should be loaded #test-debt-e2e')
    it.skip('simple flow with inject and polling read should be loaded #test-debt-e2e')
  })

  describe('modbus-server', function () {
    it.skip('should handle errors during server initialization and show in status #test-debt-e2e')
  })

  describe('modbus-flex-sequencer', function () {
    it.skip('simple Node should be loaded without client config #test-debt-e2e')
    it.skip('should be state queueing - ready to send #test-debt-e2e')
    it.skip('should handle invalid payload #test-debt-e2e')
    it.skip('should handle not ready for input #test-debt-e2e')
    it.skip('should handle error in input message processing (e2e) #test-debt-e2e')
  })

  describe('modbus-client', function () {
    it.skip('should be loaded with wrong TCP #test-debt-e2e')
  })
})
