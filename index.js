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
        title: 'Fall back to sudo if setting time without sudo fails (requires passwordless sudo for date)',
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
  plugin.statusMessage = function () {
    return `${lastMessage} ${count > 0 ? '- system time set ' + count + ' times' : ''}`
  }

  // Strict ISO-8601 check. datetime arrives from a remote SignalK stream and
  // is passed to a privileged process, so reject anything that isn't a plain
  // date string before it ever reaches spawn().
  const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/
  function isValidIsoDateTime (s) {
    return typeof s === 'string' && s.length <= 40 && ISO_8601.test(s)
  }

  function spawnSetDate (datetime, useSudo, cb) {
    const { spawn } = require('child_process')
    const dateArgs = ['--iso-8601', '-u', '-s', datetime]
    const child = useSudo
      ? spawn('sudo', ['-n', 'date'].concat(dateArgs))
      : spawn('date', dateArgs)
    let stderr = ''
    let done = false
    const finish = (err, code) => {
      if (done) return
      done = true
      cb(err, code, stderr)
    }
    child.stderr.on('data', data => {
      stderr += data.toString()
    })
    child.on('error', err => finish(err, null))
    child.on('exit', code => finish(null, code))
  }

  plugin.start = function (options) {
    let stream = app.streambundle.getSelfStream('navigation.datetime')
    if (options && options.interval > 0) {
      stream = stream.debounceImmediate(options.interval * 1000)
    } else {
      stream = stream.take(1)
    }
    plugin.unsubscribes.push(
      stream.onValue(function (datetime) {
        if (process.platform == 'win32') {
          console.error("Set-system-time supports only linux-like os's")
          return
        }
        if (plugin.useNetworkTime(options)) {
          return
        }
        if (!isValidIsoDateTime(datetime)) {
          lastMessage = 'Received datetime is not a valid ISO-8601 string; refusing to set system time'
          logError(lastMessage)
          return
        }

        const sudoFallbackEnabled = typeof options.sudo === 'undefined' || options.sudo

        spawnSetDate(datetime, false, (err, code, stderr) => {
          if (!err && code === 0) {
            count++
            lastMessage = 'System time set to ' + datetime
            debug(lastMessage)
            return
          }

          if (!sudoFallbackEnabled) {
            lastMessage =
              'Failed to set system time without sudo and sudo fallback is disabled. ' +
              'Either enable the sudo fallback option, or grant setuid on date (e.g. `chmod u+s /usr/bin/date`).'
            logError(lastMessage)
            if (stderr) logError(stderr.trim())
            return
          }

          spawnSetDate(datetime, true, (err2, code2, stderr2) => {
            if (!err2 && code2 === 0) {
              count++
              lastMessage = 'System time set to ' + datetime + ' (using sudo)'
              debug(lastMessage)
              return
            }
            lastMessage =
              'Failed to set system time. Tried direct invocation and passwordless sudo. ' +
              'Options: 1) configure passwordless sudo for the date command, or ' +
              '2) grant setuid on date (e.g. `chmod u+s /usr/bin/date`).'
            logError(lastMessage)
            if (stderr) logError('direct: ' + stderr.trim())
            if (stderr2) logError('sudo: ' + stderr2.trim())
          })
        })
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
