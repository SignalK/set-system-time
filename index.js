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
    title: 'Set System Time with sudo',
    type: 'object',
    properties: {
      interval: {
        type: 'number',
        title: 'Interval between updates in seconds (0 is once upon plugin start when datetime received)',
        default: 0
      }
    }
  })

  const SUDO_NOT_AVAILABLE = 'SUDO_NOT_AVAILABLE'

  let count = 0
  let lastMessage = ''
  plugin.statusMessage = function () {
    return `${lastMessage} ${count > 0 ? '- system time set ' + count + ' times' : ''}`
  }

  plugin.start = function (options) {
    let stream = app.streambundle.getSelfStream('navigation.datetime')
    if (options && options.interval > 0) {
      stream = stream.debounceImmediate(10 * options.interval * 1000)
    } else {
      stream = stream.take(1)
    }
    plugin.unsubscribes.push(
      stream.onValue(function (datetime) {
        var child
        if (process.platform == 'win32') {
          console.error("Set-system-time supports only linux-like os's")
        } else {
          const command = `if sudo -S -p '' echo -n < /dev/null 2> /dev/null ; then sudo date --iso-8601 -u -s "${datetime}" ; else exit 3 ; fi`
          child = require('child_process').spawn('sh', ['-c', command])
          child.on('exit', value => {
            if (value === 0) {
              count++
              lastMessage = 'System time set to ' + datetime
              debug(lastMessage)
            } else if (value === 3) {
              lastMessage =
                'Passwordless sudo not available, can not set system time'
              logError(lastMessage)
            }
          })
          child.stderr.on('data', function (data) {
            errorLog(data.toString())
          })
        }
      })
    )
  }

  plugin.stop = function () {
    plugin.unsubscribes.forEach(f => f())
  }

  return plugin
}
