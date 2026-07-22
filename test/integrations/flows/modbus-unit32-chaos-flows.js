'use strict'

const helperExtensions = require('../../helper/test-helper-extensions')

/**
 * Build 32 independent TCP Modbus server/client pairs (one UnitId context each).
 * ports[i] is the TCP port for pair index i (UnitId = i + 1).
 */
function buildUnit32ChaosFlow (ports) {
  if (!Array.isArray(ports) || ports.length !== 32) {
    throw new Error('buildUnit32ChaosFlow requires ports[32]')
  }

  const flow = [
    { id: 'tab-chaos32', type: 'tab', label: 'chaos32', disabled: false }
  ]

  for (let i = 0; i < 32; i++) {
    const unitId = i + 1
    const port = ports[i]
    const sid = 'serverC' + unitId
    const cid = 'clientC' + unitId
    const wid = 'flexWriteC' + unitId
    const gid = 'flexGetC' + unitId
    const hWid = 'helperWriteC' + unitId
    const hGid = 'helperGetC' + unitId
    const hEid = 'helperErrC' + unitId

    flow.push({
      id: sid,
      type: 'modbus-server',
      z: 'tab-chaos32',
      name: 'ChaosSrv' + unitId,
      logEnabled: false,
      hostname: '127.0.0.1',
      serverPort: port,
      responseDelay: 1,
      delayUnit: 'ms',
      coilsBufferSize: 2000,
      holdingBufferSize: 2000,
      inputBufferSize: 2000,
      discreteBufferSize: 2000,
      showErrors: false,
      wires: [[], [], [], [], []]
    })

    flow.push({
      id: cid,
      type: 'modbus-client',
      name: 'ChaosCli' + unitId,
      clienttype: 'tcp',
      bufferCommands: true,
      stateLogEnabled: false,
      queueLogEnabled: false,
      failureLogEnabled: false,
      tcpHost: '127.0.0.1',
      tcpPort: port,
      tcpType: 'DEFAULT',
      serialPort: '/dev/ttyUSB',
      serialType: 'RTU-BUFFERED',
      serialBaudrate: '9600',
      serialDatabits: '8',
      serialStopbits: '1',
      serialParity: 'none',
      serialConnectionDelay: 50,
      serialAsciiResponseStartDelimiter: '0x3A',
      unit_id: 1,
      commandDelay: 1,
      clientTimeout: 3000,
      reconnectOnTimeout: true,
      reconnectTimeout: 400,
      parallelUnitIdsAllowed: true,
      maxQueueDepth: 500,
      showErrors: false,
      showWarnings: false
    })

    flow.push({
      id: wid,
      type: 'modbus-flex-write',
      z: 'tab-chaos32',
      name: 'ChaosWrite' + unitId,
      showStatusActivities: false,
      showErrors: false,
      showWarnings: false,
      server: cid,
      emptyMsgOnFail: false,
      keepMsgProperties: true,
      delayOnStart: false,
      startDelayTime: '',
      wires: [[hWid], []]
    })

    flow.push({
      id: gid,
      type: 'modbus-flex-getter',
      z: 'tab-chaos32',
      name: 'ChaosGet' + unitId,
      showStatusActivities: false,
      showErrors: false,
      showWarnings: false,
      logIOActivities: false,
      server: cid,
      useIOFile: false,
      ioFile: '',
      useIOForPayload: false,
      emptyMsgOnFail: false,
      keepMsgProperties: true,
      delayOnStart: false,
      startDelayTime: '',
      wires: [[hGid], [hEid]]
    })

    flow.push({ id: hWid, type: 'helper', z: 'tab-chaos32', wires: [] })
    flow.push({ id: hGid, type: 'helper', z: 'tab-chaos32', wires: [] })
    flow.push({ id: hEid, type: 'helper', z: 'tab-chaos32', wires: [] })
  }

  return helperExtensions.cleanFlowPositionData(flow)
}

module.exports = {
  buildUnit32ChaosFlow
}
