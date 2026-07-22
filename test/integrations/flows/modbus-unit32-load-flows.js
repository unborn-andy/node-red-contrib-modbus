'use strict'

const helperExtensions = require('../../helper/test-helper-extensions')

/**
 * 32 UnitId parallel load: one TCP Modbus-Server answers all UnitIds
 * (standard Modbus TCP multiplexing — no need for 32 listeners).
 */
module.exports = {
  unit32LoadFlow: helperExtensions.cleanFlowPositionData([
    { id: 'tab-u32', type: 'tab', label: 'unit32-load', disabled: false },
    {
      id: 'serverU32',
      type: 'modbus-server',
      z: 'tab-u32',
      name: 'U32Server',
      logEnabled: false,
      hostname: '127.0.0.1',
      serverPort: 10832,
      responseDelay: 1,
      delayUnit: 'ms',
      coilsBufferSize: 8000,
      holdingBufferSize: 8000,
      inputBufferSize: 8000,
      discreteBufferSize: 8000,
      showErrors: false,
      wires: [[], [], [], [], []]
    },
    {
      id: 'clientU32',
      type: 'modbus-client',
      name: 'U32Client',
      clienttype: 'tcp',
      bufferCommands: true,
      stateLogEnabled: false,
      queueLogEnabled: false,
      failureLogEnabled: false,
      tcpHost: '127.0.0.1',
      tcpPort: 10832,
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
      clientTimeout: 8000,
      reconnectOnTimeout: true,
      reconnectTimeout: 500,
      parallelUnitIdsAllowed: true,
      maxQueueDepth: 10000,
      showErrors: false,
      showWarnings: false
    },
    {
      id: 'flexWriteU32',
      type: 'modbus-flex-write',
      z: 'tab-u32',
      name: 'U32Write',
      showStatusActivities: false,
      showErrors: false,
      showWarnings: false,
      server: 'clientU32',
      emptyMsgOnFail: false,
      keepMsgProperties: true,
      delayOnStart: false,
      startDelayTime: '',
      wires: [['helperWriteU32'], []]
    },
    {
      id: 'flexGetU32',
      type: 'modbus-flex-getter',
      z: 'tab-u32',
      name: 'U32Get',
      showStatusActivities: false,
      showErrors: false,
      showWarnings: false,
      logIOActivities: false,
      server: 'clientU32',
      useIOFile: false,
      ioFile: '',
      useIOForPayload: false,
      emptyMsgOnFail: false,
      keepMsgProperties: true,
      delayOnStart: false,
      startDelayTime: '',
      wires: [['helperGetU32'], ['helperGetErrU32']]
    },
    { id: 'helperWriteU32', type: 'helper', z: 'tab-u32', wires: [] },
    { id: 'helperGetU32', type: 'helper', z: 'tab-u32', wires: [] },
    { id: 'helperGetErrU32', type: 'helper', z: 'tab-u32', wires: [] }
  ])
}
