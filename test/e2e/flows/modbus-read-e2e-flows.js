const helperExtensions = require('../../helper/test-helper-extensions')

module.exports = {

  testFlowReading: helperExtensions.cleanFlowPositionData([
    {
      id: 'e5faba87.571118',
      type: 'tab',
      label: 'Test Modbus Read Flow',
      disabled: false,
      info: ''
    },
    {
      id: '1f9596ed.279b89',
      type: 'modbus-read',
      z: 'e5faba87.571118',
      name: 'ModbusTestRead',
      topic: '',
      showStatusActivities: false,
      logIOActivities: false,
      showErrors: false,
      unitid: '',
      dataType: 'HoldingRegister',
      adr: '0',
      quantity: '10',
      rate: '4',
      rateUnit: 's',
      delayOnStart: false,
      startDelayTime: '',
      server: '354de6bb.6c3652',
      useIOFile: false,
      ioFile: '',
      useIOForPayload: false,
      emptyMsgOnFail: false,
      x: 170,
      y: 160,
      wires: [
        [
          'h1'
        ],
        [
          'h2'
        ]
      ]
    },
    {
      id: 'h1',
      type: 'helper',
      z: 'e5faba87.571118',
      active: true,
      x: 410,
      y: 140,
      wires: []
    },
    {
      id: 'h2',
      type: 'helper',
      z: 'e5faba87.571118',
      active: true,
      x: 410,
      y: 180,
      wires: []
    },
    {
      id: '96005591.02f0d8',
      type: 'modbus-server',
      z: 'e5faba87.571118',
      name: '',
      logEnabled: false,
      hostname: '0.0.0.0',
      serverPort: '9507',
      responseDelay: 100,
      delayUnit: 'ms',
      coilsBufferSize: 10000,
      holdingBufferSize: 10000,
      inputBufferSize: 10000,
      discreteBufferSize: 10000,
      showErrors: false,
      x: 160,
      y: 80,
      wires: [
        [],
        [],
        [],
        [],
        []
      ]
    },
    {
      id: '354de6bb.6c3652',
      type: 'modbus-client',
      z: 'e5faba87.571118',
      name: 'ModbusTestTCPClient',
      clienttype: 'tcp',
      bufferCommands: true,
      stateLogEnabled: false,
      queueLogEnabled: false,
      tcpHost: '127.0.0.1',
      tcpPort: '9507',
      tcpType: 'DEFAULT',
      serialPort: '/dev/ttyUSB',
      serialType: 'RTU-BUFFERD',
      serialBaudrate: '9600',
      serialDatabits: '8',
      serialStopbits: '1',
      serialParity: 'none',
      serialConnectionDelay: '100',
      unit_id: '1',
      commandDelay: '1',
      clientTimeout: '1000',
      reconnectOnTimeout: true,
      reconnectTimeout: 200,
      parallelUnitIdsAllowed: true
    }
  ]),
  testFlowFore2eTesting: helperExtensions.cleanFlowPositionData([
    {
      id: '1388bd0351770565',
      type: 'modbus-server',
      z: 'd2df7906b42a4628',
      name: '',
      logEnabled: false,
      hostname: '127.0.0.1',
      serverPort: '7502',
      responseDelay: 100,
      delayUnit: 'ms',
      coilsBufferSize: 10000,
      holdingBufferSize: 10000,
      inputBufferSize: 10000,
      discreteBufferSize: 10000,
      showErrors: false,
      x: 400,
      y: 100,
      wires: [
        [],
        [],
        [],
        [],
        []
      ]
    },
    {
      id: '7ae5c3a814b3c02b',
      type: 'modbus-read',
      z: 'd2df7906b42a4628',
      name: '',
      topic: '',
      showStatusActivities: false,
      logIOActivities: false,
      showErrors: false,
      showWarnings: true,
      unitid: '1',
      dataType: 'HoldingRegister',
      adr: '1',
      quantity: '8',
      rate: '5',
      rateUnit: 's',
      delayOnStart: false,
      startDelayTime: '',
      server: '699247754b70bb94',
      useIOFile: false,
      ioFile: '',
      useIOForPayload: false,
      emptyMsgOnFail: false,
      x: 300,
      y: 200,
      wires: [
        [
          'e7a6dd8822c4cfc6'
        ],
        []
      ]
    },
    {
      id: '699247754b70bb94',
      type: 'modbus-client',
      name: '',
      clienttype: 'tcp',
      bufferCommands: true,
      stateLogEnabled: false,
      queueLogEnabled: false,
      failureLogEnabled: true,
      tcpHost: '127.0.0.1',
      tcpPort: '7502',
      tcpType: 'DEFAULT',
      serialPort: '/dev/ttyUSB',
      serialType: 'RTU-BUFFERD',
      serialBaudrate: '9600',
      serialDatabits: '8',
      serialStopbits: '1',
      serialParity: 'none',
      serialConnectionDelay: '100',
      serialAsciiResponseStartDelimiter: '0x3A',
      unit_id: '1',
      commandDelay: '1',
      clientTimeout: '1000',
      reconnectOnTimeout: true,
      reconnectTimeout: '2000',
      parallelUnitIdsAllowed: true,
      showErrors: false,
      showWarnings: true,
      showLogs: true
    }
  ])
}
