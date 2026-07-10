/**
 Copyright (c) since the year 2016 Klaus Landsdorf (http://plus4nodered.com/)
 All rights reserved.
 node-red-contrib-modbus

 @author <a href="mailto:klaus.landsdorf@bianco-royal.de">Klaus Landsdorf</a> (Bianco Royal)
 */
'use strict'
// SOURCE-MAP-REQUIRED

const internalDebug = require('debug')('contribModbus:core:server')

const coreServer = {}

coreServer.internalDebug = internalDebug
coreServer.bufferFactor = 8
coreServer.memoryTypes = ['holding', 'coils', 'input', 'discrete']
coreServer.memoryUint16Types = ['holding', 'input']
coreServer.memoryUint8Types = ['coils', 'discrete']

coreServer.getLogFunction = function (node) {
  if (node.internalDebugLog) {
    return node.internalDebugLog
  } else {
    return internalDebug
  }
}

coreServer.isValidMemoryMessage = function (msg) {
  return msg.payload !== undefined &&
    msg.payload.register &&
    Number.isInteger(msg.payload.address) &&
    msg.payload.address >= 0 &&
    msg.payload.address <= 65535
}

coreServer.isValidMessage = function (msg) {
  return msg !== undefined && msg.payload !== undefined
}

coreServer.copyToModbusFlexBuffer = function (node, msg) {
  switch (msg.payload.register) {
    case 'holding':
      msg.bufferData.copy(node.registers, msg.bufferSplitAddress)
      break
    case 'coils':
      msg.bufferData.copy(node.coils, msg.bufferAddress)
      break
    case 'input':
      msg.bufferData.copy(node.registers, msg.bufferAddress)
      break
    case 'discrete':
      msg.bufferData.copy(node.coils, msg.bufferSplitAddress)
      break
    default:
      return false
  }
  return true
}

coreServer.writeToModbusFlexBuffer = function (node, msg) {
  switch (msg.payload.register) {
    case 'holding':
      node.registers.writeUInt16BE((Buffer.isBuffer(msg.bufferPayload)) ? msg.bufferPayload.readUInt16BE(0) : msg.bufferPayload, msg.bufferSplitAddress)
      break
    case 'coils':
      node.coils.writeUInt8((Buffer.isBuffer(msg.bufferPayload)) ? msg.bufferPayload.readUInt8(0) : msg.bufferPayload, msg.bufferAddress)
      break
    case 'input':
      node.registers.writeUInt16BE((Buffer.isBuffer(msg.bufferPayload)) ? msg.bufferPayload.readUInt16BE(0) : msg.bufferPayload, msg.bufferAddress)
      break
    case 'discrete':
      node.coils.writeUInt8((Buffer.isBuffer(msg.bufferPayload)) ? msg.bufferPayload.readUInt8(0) : msg.bufferPayload, msg.bufferSplitAddress)
      break
    default:
      return false
  }
  return true
}

coreServer.writeModbusFlexServerMemory = function (node, msg) {
  msg.bufferSplitAddress = (parseInt(msg.payload.address) + parseInt(node.splitAddress)) * coreServer.bufferFactor
  msg.bufferAddress = parseInt(msg.payload.address) * coreServer.bufferFactor

  if (coreServer.convertInputForBufferWrite(msg)) {
    return coreServer.copyToModbusFlexBuffer(node, msg)
  } else {
    return coreServer.writeToModbusFlexBuffer(node, msg)
  }
}

coreServer.convertInputForBufferWrite = function (msg) {
  let isMultipleWrite = false
  if (msg.payload.value?.length) {
    msg.bufferPayload = new Uint8Array(msg.payload?.value)
    msg.bufferData = Buffer.alloc(msg.bufferPayload.buffer.byteLength, msg.bufferPayload)
    isMultipleWrite = true
    msg.wasMultipleWrite = true
  } else {
    msg.bufferPayload = Number(msg.payload.value)
    msg.wasMultipleWrite = false
  }

  return isMultipleWrite
}

coreServer.copyToModbusBuffer = function (node, msg) {
  switch (msg.payload.register) {
    case 'holding':
      msg.bufferData.copy(node.modbusServer.holding, msg.bufferAddress)
      break
    case 'coils':
      msg.bufferData.copy(node.modbusServer.coils, msg.bufferAddress)
      break
    case 'input':
      msg.bufferData.copy(node.modbusServer.input, msg.bufferAddress)
      break
    case 'discrete':
      msg.bufferData.copy(node.modbusServer.discrete, msg.bufferAddress)
      break
    default:
      return false
  }
  return true
}

coreServer.writeToModbusBuffer = function (node, msg) {
  switch (msg.payload.register) {
    case 'holding':
      node.modbusServer.holding.writeUInt16BE((Buffer.isBuffer(msg.bufferPayload)) ? msg.bufferPayload.readUInt16BE(0) : msg.bufferPayload, msg.bufferAddress)
      break
    case 'coils':
      node.modbusServer.coils.writeUInt8((Buffer.isBuffer(msg.bufferPayload)) ? msg.bufferPayload.readUInt8(0) : msg.bufferPayload, msg.bufferAddress)
      break
    case 'input':
      node.modbusServer.input.writeUInt16BE((Buffer.isBuffer(msg.bufferPayload)) ? msg.bufferPayload.readUInt16BE(0) : msg.bufferPayload, msg.bufferAddress)
      break
    case 'discrete':
      node.modbusServer.discrete.writeUInt8((Buffer.isBuffer(msg.bufferPayload)) ? msg.bufferPayload.readUInt8(0) : msg.bufferPayload, msg.bufferAddress)
      break
    default:
      return false
  }
  return true
}

coreServer.writeModbusServerMemory = function (node, msg) {
  msg.bufferAddress = parseInt(msg.payload.address) * coreServer.bufferFactor

  if (coreServer.convertInputForBufferWrite(msg)) {
    return coreServer.copyToModbusBuffer(node, msg)
  } else {
    return coreServer.writeToModbusBuffer(node, msg)
  }
}

coreServer.writeToServerMemory = function (node, msg) {
  msg.payload.register = msg.payload.register.toLowerCase()
  try {
    if (coreServer.memoryTypes.includes(msg.payload.register)) {
      coreServer.writeModbusServerMemory(node, msg)
    }
  } catch (err) {
    msg.error = err
    node.error(err)
  }
}

coreServer.writeToFlexServerMemory = function (node, msg) {
  msg.payload.register = msg.payload.register ? msg.payload.register.toLowerCase() : undefined; try {
    if (coreServer.memoryTypes.includes(msg.payload.register)) {
      coreServer.writeModbusFlexServerMemory(node, msg)
    }
  } catch (err) {
    msg.error = err
    node.error(err)
  }
}

module.exports = coreServer
