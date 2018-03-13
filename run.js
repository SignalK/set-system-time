const Bacon = require('baconjs')
const datetimeStream = new Bacon.Bus()

const setSystemTime = require('./')({
  streambundle: {
    getSelfStream: path => {
      if (path === 'navigation.datetime') {
        return datetimeStream
      }
    }
  }
})

setSystemTime.start()
setImmediate(() => {
  datetimeStream.push(new Date().toISOString())
})
setTimeout(() => {
  console.log(setSystemTime.statusMessage())
}, 200)
