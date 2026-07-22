'use strict'

const path = require('path')
const helperExtensions = require('../../helper/test-helper-extensions')

const IO_PATH = path.resolve(__dirname, '../../resources/roundtrip-io.json')

/**
 * Live FSM reconnect fixtures. Ports filled at runtime.
 * Short reconnectTimeout so outage→recovery stays within Mocha limits.
 */
module.exports = {
  reconnectFilterFlow: helperExtensions.cleanFlowPositionData([
    { id: 'tab-fsm', type: 'tab', label: 'fsm-reconnect', disabled: false },
    {
      id: 'serverFsm',
      type: 'modbus-server',
      z: 'tab-fsm',
      name: 'FsmServer',
      logEnabled: false,
      hostname: '127.0.0.1',
      serverPort: 10701,
      responseDelay: 2,
      delayUnit: 'ms',
      coilsBufferSize: 4000,
      holdingBufferSize: 4000,
      inputBufferSize: 4000,
      discreteBufferSize: 4000,
      showErrors: false,
      wires: [[], [], [], [], []]
    },
    {
      id: 'clientFsm',
      type: 'modbus-client',
      name: 'FsmClient',
      clienttype: 'tcp',
      bufferCommands: true,
      stateLogEnabled: false,
      queueLogEnabled: false,
      failureLogEnabled: false,
      tcpHost: '127.0.0.1',
      tcpPort: 10701,
      tcpType: 'DEFAULT',
      serialPort: '/dev/ttyUSB',
      serialType: 'RTU-BUFFERED',
      serialBaudrate: '9600',
      serialDatabits: '8',
      serialStopbits: '1',
      serialParity: 'none',
      serialConnectionDelay: 100,
      serialAsciiResponseStartDelimiter: '0x3A',
      unit_id: 1,
      commandDelay: 1,
      clientTimeout: 2000,
      reconnectOnTimeout: true,
      reconnectTimeout: 300,
      parallelUnitIdsAllowed: true,
      maxQueueDepth: 200,
      showErrors: false,
      showWarnings: false
    },
    {
      id: 'ioFsm',
      type: 'modbus-io-config',
      name: 'FsmIO',
      path: IO_PATH,
      format: 'utf8',
      addressOffset: 0
    },
    {
      id: 'flexWriteFsm',
      type: 'modbus-flex-write',
      z: 'tab-fsm',
      name: 'FsmWrite',
      showStatusActivities: false,
      showErrors: false,
      showWarnings: false,
      server: 'clientFsm',
      emptyMsgOnFail: false,
      keepMsgProperties: true,
      delayOnStart: false,
      startDelayTime: '',
      wires: [['helperWriteFsm'], []]
    },
    {
      id: 'flexGetFsm',
      type: 'modbus-flex-getter',
      z: 'tab-fsm',
      name: 'FsmGet',
      showStatusActivities: false,
      showErrors: false,
      showWarnings: false,
      logIOActivities: false,
      server: 'clientFsm',
      useIOFile: true,
      ioFile: 'ioFsm',
      useIOForPayload: true,
      emptyMsgOnFail: true,
      keepMsgProperties: true,
      delayOnStart: false,
      startDelayTime: '',
      wires: [['filterFsm'], ['helperErrFsm']]
    },
    {
      id: 'filterFsm',
      type: 'modbus-response-filter',
      z: 'tab-fsm',
      name: 'Filter iRoundTrip',
      filter: 'iRoundTrip',
      registers: 0,
      ioFile: 'ioFsm',
      filterResponseBuffer: true,
      filterValues: true,
      filterInput: true,
      showStatusActivities: false,
      showErrors: false,
      wires: [['helperFilterFsm']]
    },
    { id: 'helperWriteFsm', type: 'helper', z: 'tab-fsm', wires: [] },
    { id: 'helperFilterFsm', type: 'helper', z: 'tab-fsm', wires: [] },
    { id: 'helperErrFsm', type: 'helper', z: 'tab-fsm', wires: [] }
  ])
}
