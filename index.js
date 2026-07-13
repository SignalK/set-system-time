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
  plugin.statusMessage = function () {
    return `${lastMessage} ${count > 0 ? '- system time set ' + count + ' times' : ''}`
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
        var child
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
            const useSudoFallback = typeof options.sudo === 'undefined' || options.sudo
            // Convert ISO 8601 datetime to format compatible with both GNU date and BusyBox date
            // e.g., "2024-01-10T17:55:03.000Z" → "2024-01-10 17:55:03"
            const dateStr = datetime.replace('T', ' ').replace(/\.\d+Z?$|Z$/, '')
            const setDate = `date -u -s "${dateStr}"`

            // First try without sudo (works in Docker with setuid bit on /usr/bin/date)
            child = require('child_process').spawn('sh', ['-c', setDate])
            child.on('exit', value => {
              if (value === 0) {
                count++
                lastMessage = 'System time set to ' + datetime
                debug(lastMessage)
              } else if (useSudoFallback) {
                // Try with sudo as fallback
                const sudoCommand = `if sudo -n date &> /dev/null ; then sudo ${setDate} ; else exit 3 ; fi`
                const sudoChild = require('child_process').spawn('sh', ['-c', sudoCommand])
                sudoChild.on('exit', sudoValue => {
                  if (sudoValue === 0) {
                    count++
                    lastMessage = 'System time set to ' + datetime + ' (using sudo)'
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
              // Suppress stderr from first attempt if sudo fallback is enabled
              if (!useSudoFallback) {
                lastMessage = data.toString()
                logError(lastMessage)
              }
            })
          }
        }
      })
    )
  }

  plugin.useNetworkTime = (options) => {
    if ( typeof options.preferNetworkTime !== 'undefined' && options.preferNetworkTime == true ){
      const chronyCmd = "chronyc sources 2> /dev/null | cut -c2 | grep -ce '-\|*'";
      try {
        validSources = require('child_process').execSync(chronyCmd,{timeout:500, stdio: ['ignore', 'pipe', 'ignore']});
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
