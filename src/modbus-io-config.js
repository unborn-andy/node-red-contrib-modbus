/**
 Copyright (c) since the year 2016 Klaus Landsdorf (http://plus4nodered.com/)
 All rights reserved.
 node-red-contrib-modbus
 node-red-contrib-modbusio

 @author <a href="mailto:klaus.landsdorf@bianco-royal.de">Klaus Landsdorf</a> (Bianco Royal)
 */

/**
 * Modbus IO Config node.
 * @module NodeRedModbusIOConfig
 *
 * @param RED
 */
module.exports = function (RED) {
  'use strict'
  // SOURCE-MAP-REQUIRED
  const coreIO = require('./core/modbus-io-core')

  function ModbusIOConfigNode (config) {
    const fs = require('fs-extra')
    const path = require('path')
    const UNLIMITED_LISTENERS = 0

    RED.nodes.createNode(this, config)

    this.name = config.name
    this.path = config.path
    this.format = config.format
    this.addressOffset = config.addressOffset

    const node = this
    node.setMaxListeners(UNLIMITED_LISTENERS)
    node.lastUpdatedAt = null

    // Resolve relative paths: cwd first, then package root (…/extras/… next to modbus/)
    if (node.path && !path.isAbsolute(node.path)) {
      const fromCwd = path.resolve(node.path)
      const fromPackage = path.resolve(path.join(__dirname, '..', node.path))
      if (fs.existsSync(fromCwd) && fs.statSync(fromCwd).isFile()) {
        node.path = fromCwd
      } else if (fs.existsSync(fromPackage) && fs.statSync(fromPackage).isFile()) {
        node.path = fromPackage
      }
    }

    if (!fs.existsSync(node.path)) {
      coreIO.internalDebug('IO File Not Found ' + node.path)
      node.warn('Modbus IO File Not Found ' + node.path)
    } else if (!fs.statSync(node.path).isFile()) {
      coreIO.internalDebug('IO Path Is Not A File ' + node.path)
      node.warn('Modbus IO Path Is Not A File ' + node.path)
    } else {
      node.lineReader = new coreIO.LineByLineReader(node.path)
      coreIO.internalDebug('Read IO File ' + node.path)
      node.configData = []

      function setLineReaderEvents () {
        node.lineReader.removeAllListeners()

        node.lineReader.on('error', function (err) {
          coreIO.internalDebug(err.message)
          node.warn('Modbus IO File Read Error: ' + err.message)
        })

        node.lineReader.on('line', function (line) {
          if (!line) {
            return
          }
          try {
            const mapping = (typeof line === 'string') ? JSON.parse(line) : line
            if (mapping && mapping.name && mapping.valueAddress) {
              node.configData.push(mapping)
            }
          } catch (err) {
            coreIO.internalDebug('IO File Line Parse Error: ' + err.message + ' line=' + line)
          }
        })

        node.lineReader.on('end', function () {
          node.lastUpdatedAt = Date.now()
          coreIO.internalDebug('Read IO Done From File ' + node.path)
          node.warn({
            payload: coreIO.allValueNamesFromIOFile(node),
            name: 'Modbus Value Names From IO File',
            path: node.path
          })
          node.emit('updatedConfig', node.configData)
        })

        coreIO.internalDebug('Loading IO File Started For ' + node.path)
      }

      setLineReaderEvents()

      node.watcher = fs.watchFile(node.path, (curr, prev) => {
        coreIO.internalDebug(`the current mtime is: ${curr.mtime}`)
        coreIO.internalDebug(`the previous mtime was: ${prev.mtime}`)

        if (curr.mtime !== prev.mtime) {
          coreIO.internalDebug('Reload IO File ' + node.path)
          node.configData = []
          delete node.lastUpdatedAt
          try {
            if (node.lineReader) {
              node.lineReader.removeAllListeners()
              if (typeof node.lineReader.close === 'function') {
                node.lineReader.close()
              }
            }
          } catch (err) {
            coreIO.internalDebug('IO File reload close error: ' + err.message)
          }
          node.lineReader = new coreIO.LineByLineReader(node.path)
          setLineReaderEvents()
          coreIO.internalDebug('Reloading IO File Started For ' + node.path)
        }
      })
    }

    node.on('close', function (done) {
      if (node.path) {
        try {
          fs.unwatchFile(node.path)
        } catch (err) {
          coreIO.internalDebug('IO File unwatch error: ' + err.message)
        }
      }
      if (node.lineReader) {
        try {
          node.lineReader.removeAllListeners()
          if (typeof node.lineReader.close === 'function') {
            node.lineReader.close()
          }
        } catch (err) {
          coreIO.internalDebug('IO File close error: ' + err.message)
        }
        node.lineReader = null
      }
      node.removeAllListeners()
      done()
    })
  }

  RED.nodes.registerType('modbus-io-config', ModbusIOConfigNode)
}
