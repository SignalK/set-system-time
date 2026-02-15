const fs = require('fs')
const path = require('path')

module.exports = function (app) {
  const logError =
    app.error ||
    (err => {
      console.error(err)
    })
  const debug =
    app.debug ||
    (msg => {
      console.log(msg)
    })

  var plugin = {
    unsubscribes: []
  }

  plugin.id = 'set-system-time'
  plugin.name = 'Set System Time'
  plugin.description =
    'Plugin that sets the system date & time from navigation.datetime delta messages'

  plugin.schema = () => ({
    title: 'Set System Time',
    type: 'object',
    properties: {
      interval: {
        type: 'number',
        title: 'Interval between updates in seconds (0 is once upon plugin start when datetime received)',
        default: 0
      },
      sudo: {
        type: 'boolean',
        title: 'Use sudo as fallback when setting time without sudo fails',
        default: true
      },
      preferNetworkTime: {
        type: 'boolean',
        title: 'Set system time only if no other source is available (only chrony detected)',
        default: true
      }
    }
  })

  let count = 0
  let lastMessage = ''
  let lastGoodTime = null
  plugin.statusMessage = function () {
    return `${lastMessage} ${count > 0 ? '- system time set ' + count + ' times' : ''}`
  }

  const minimumYear = 2026

  function getLastGoodTimePath() {
    const dataDir = typeof app.getDataDirPath === 'function' ? app.getDataDirPath() : null
    if (!dataDir) {
      return null
    }
    return path.join(dataDir, 'last-good-time.json')
  }

  function loadLastGoodTime() {
    const filePath = getLastGoodTimePath()
    if (!filePath || !fs.existsSync(filePath)) {
      return null
    }
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      const datetime = data && data.datetime
      if (!datetime || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/.test(datetime)) {
        return null
      }
      const parsedDate = new Date(datetime)
      if (Number.isNaN(parsedDate.getTime())) {
        return null
      }
      return datetime
    } catch (err) {
      logError('Failed to read last-good time: ' + err.message)
      return null
    }
  }

  function saveLastGoodTime(datetime) {
    const filePath = getLastGoodTimePath()
    if (!filePath) {
      return
    }
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, JSON.stringify({ datetime }), 'utf8')
    } catch (err) {
      logError('Failed to write last-good time: ' + err.message)
    }
  }

  function setSystemTime(datetime, useSudoFallback, sourceLabel) {
    const dateStr = datetime.replace('T', ' ').replace(/\.\d+Z?$|Z$/, '')
    const setDate = `date -u -s "${dateStr}"`
    const label = sourceLabel ? ` (${sourceLabel})` : ''

    const child = require('child_process').spawn('sh', ['-c', setDate])
    child.on('exit', value => {
      if (value === 0) {
        count++
        lastGoodTime = datetime
        saveLastGoodTime(datetime)
        lastMessage = 'System time set to ' + datetime + label
        debug(lastMessage)
      } else if (useSudoFallback) {
        const sudoCommand = `if sudo -n date &> /dev/null ; then sudo ${setDate} ; else exit 3 ; fi`
        const sudoChild = require('child_process').spawn('sh', ['-c', sudoCommand])
        sudoChild.on('exit', sudoValue => {
          if (sudoValue === 0) {
            count++
            lastGoodTime = datetime
            saveLastGoodTime(datetime)
            lastMessage = 'System time set to ' + datetime + ' (using sudo)' + label
            debug(lastMessage)
          } else if (sudoValue === 3) {
            lastMessage =
              'Setting time failed. Passwordless sudo not available. Configure sudoers or use Docker image with setuid bit on /usr/bin/date'
            logError(lastMessage)
          }
        })
        sudoChild.stderr.on('data', function (data) {
          lastMessage = data.toString()
          logError(lastMessage)
        })
      } else {
        lastMessage =
          'Setting time failed. Enable sudo fallback or use Docker image with setuid bit on /usr/bin/date'
        logError(lastMessage)
      }
    })
    child.stderr.on('data', function (data) {
      if (!useSudoFallback) {
        lastMessage = data.toString()
        logError(lastMessage)
      }
    })
  }

  plugin.start = function (options) {
    lastGoodTime = loadLastGoodTime()
    let stream = app.streambundle.getSelfStream('navigation.datetime')
    if (options && options.interval > 0) {
      stream = stream.debounceImmediate(options.interval * 1000)
    } else {
      stream = stream.take(1)
    }
    if (!plugin.useNetworkTime(options) && lastGoodTime) {
      const lastGoodDate = new Date(lastGoodTime)
      if (!Number.isNaN(lastGoodDate.getTime()) && Date.now() < lastGoodDate.getTime()) {
        const useSudoFallback = typeof options.sudo === 'undefined' || options.sudo
        setSystemTime(lastGoodTime, useSudoFallback, 'from last-good time')
      }
    }
    plugin.unsubscribes.push(
      stream.onValue(function (datetime) {
        if (process.platform == 'win32') {
          console.error("Set-system-time supports only linux-like os's")
        } else {
          if( ! plugin.useNetworkTime(options) ){
            // Validate datetime format to prevent command injection
            if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/.test(datetime)) {
              lastMessage = 'Invalid datetime format received: ' + String(datetime).substring(0, 50)
              logError(lastMessage)
              return
            }
            const parsedDate = new Date(datetime)
            if (Number.isNaN(parsedDate.getTime())) {
              lastMessage = 'Invalid datetime value received: ' + String(datetime).substring(0, 50)
              logError(lastMessage)
              return
            }
            if (parsedDate.getUTCFullYear() < minimumYear) {
              lastMessage = `Ignoring GPS time (${datetime}) older than minimum year ${minimumYear}`
              logError(lastMessage)
              return
            }
            if (lastGoodTime) {
              const lastGoodDate = new Date(lastGoodTime)
              if (!Number.isNaN(lastGoodDate.getTime()) && parsedDate.getTime() < lastGoodDate.getTime()) {
                lastMessage = `Ignoring GPS time (${datetime}) older than last-good time ${lastGoodTime}`
                logError(lastMessage)
                return
              }
            }
            const useSudoFallback = typeof options.sudo === 'undefined' || options.sudo
            setSystemTime(datetime, useSudoFallback, '')
          }
        }
      })
    )
  }

  plugin.useNetworkTime = (options) => {
    if ( typeof options.preferNetworkTime !== 'undefined' && options.preferNetworkTime == true ){
      const chronyCmd = "chronyc sources 2> /dev/null | cut -c2 | grep -ce '-\|*'";
      try {
        validSources = require('child_process').execSync(chronyCmd,{timeout:500});
      } catch (e) {
        return false
      }
      if(validSources > 0 ){
        return true
      }
    }
    return false
  }

  plugin.stop = function () {
    plugin.unsubscribes.forEach(f => f())
  }

  return plugin
}
