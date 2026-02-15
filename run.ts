const Bacon = require('baconjs')
const datetimeStream = new Bacon.Bus()

const plugin = require('./index')({
  streambundle: {
    getSelfStream: path => {
      if (path === 'navigation.datetime') {
        return datetimeStream
      }
    }
  }
})

plugin.start()
setImmediate(() => {
  datetimeStream.push(new Date().toISOString())
})
setTimeout(() => {
  console.log(plugin.statusMessage())
}, 200)
