// const streamBundle = require('../streambundle');
// const debug = require('debug')('signalk-server:interfaces:setSystemDateTime');

module.exports = function(app) {
  var plugin = {
    unsubscribes: []
  };

  plugin.id = "set-system-time"
  plugin.name = "Set System Time"
  plugin.description = "Plugin that sets the system date & time from navigation.datetime delta messages"

  plugin.schema = {
    title: "Set System Time",
    type: "object",
    properties: {
      interval: {
        type: "number",
        title: "Interval between updates in seconds",
        default: 60
      }
    }
  }


  plugin.start = function(options) {
    plugin.unsubscribes.push(app.streamBundle.getStream('navigation.datetime')
      .debounceImmediate(10* options.interval * 1000)
      .onValue(function(datetime) {
        var child
        if (process.platform == 'win32')
          console.error("Set-system-time supports only linux-like os's")
        else
          var command = 'sudo date --iso-8601 -u -s "' + datetime + '"'
          debug(command)
          child = require('child_process').spawn('sh', ['-c', command]);
        child.stderr.on('data', function(data) {
          console.error(data.toString());
        })
      })
    )
  }

  plugin.stop = function() {
    plugin.unsubscribes.forEach(f => f())
  };

  return plugin;
};
