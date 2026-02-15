const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const Bacon = require('baconjs')

function createStream() {
  let handler = null
  const stream = {
    debounceImmediate: () => stream,
    take: () => stream,
    onValue: fn => {
      handler = fn
      return () => {}
    },
    push: value => {
      if (handler) {
        handler(value)
      }
    }
  }
  return stream
}

function createChild() {
  const child = /** @type {EventEmitter & { stderr: EventEmitter }} */ (new EventEmitter())
  child.stderr = new EventEmitter()
  return child
}

function loadPlugin(stubs = {}) {
  const childProcess = require('node:child_process')
  const fs = require('node:fs')

  const originals = {
    execSync: childProcess.execSync,
    spawn: childProcess.spawn,
    existsSync: fs.existsSync,
    readFileSync: fs.readFileSync,
    writeFileSync: fs.writeFileSync,
    mkdirSync: fs.mkdirSync
  }

  if (stubs.execSync) {
    childProcess.execSync = stubs.execSync
  }
  if (stubs.spawn) {
    childProcess.spawn = stubs.spawn
  }
  if (stubs.existsSync) {
    fs.existsSync = stubs.existsSync
  }
  if (stubs.readFileSync) {
    fs.readFileSync = (...args) => stubs.readFileSync(originals.readFileSync, ...args)
  }
  if (stubs.writeFileSync) {
    fs.writeFileSync = stubs.writeFileSync
  }
  if (stubs.mkdirSync) {
    fs.mkdirSync = stubs.mkdirSync
  }

  delete require.cache[require.resolve('../dist/index.js')]
  const factory = require('../dist/index.js')

  function restore() {
    childProcess.execSync = originals.execSync
    childProcess.spawn = originals.spawn
    fs.existsSync = originals.existsSync
    fs.readFileSync = originals.readFileSync
    fs.writeFileSync = originals.writeFileSync
    fs.mkdirSync = originals.mkdirSync
    delete require.cache[require.resolve('../dist/index.js')]
  }

  return { factory, restore }
}

function createApp(stream, dataDirPath = '/tmp/signalk-test') {
  return {
    streambundle: {
      getSelfStream: () => stream
    },
    getDataDirPath: () => dataDirPath,
    error: () => {},
    debug: () => {}
  }
}

test('useNetworkTime returns false when options missing', () => {
  const { factory, restore } = loadPlugin()
  const plugin = factory(createApp(createStream()))
  assert.equal(plugin.useNetworkTime(), false)
  restore()
})

test('useNetworkTime returns true when chrony reports sources', () => {
  const { factory, restore } = loadPlugin({
    execSync: () => Buffer.from('1\n')
  })
  const plugin = factory(createApp(createStream()))
  assert.equal(plugin.useNetworkTime({ preferNetworkTime: true }), true)
  restore()
})

test('useNetworkTime returns false when chrony fails', () => {
  const { factory, restore } = loadPlugin({
    execSync: () => {
      throw new Error('boom')
    }
  })
  const plugin = factory(createApp(createStream()))
  assert.equal(plugin.useNetworkTime({ preferNetworkTime: true }), false)
  restore()
})

test('valid datetime triggers system time set', async () => {
  const spawnCalls = []
  const { factory, restore } = loadPlugin({
    spawn: (cmd, args) => {
      spawnCalls.push({ cmd, args })
      const child = createChild()
      process.nextTick(() => child.emit('exit', 0))
      return child
    },
    writeFileSync: () => {},
    mkdirSync: () => {}
  })

  const stream = createStream()
  const plugin = factory(createApp(stream))
  plugin.start({ preferNetworkTime: false, sudo: false })

  stream.push('2026-05-10T12:34:56Z')
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(spawnCalls.length, 1)
  assert.match(plugin.statusMessage(), /System time set to 2026-05-10T12:34:56Z/)
  restore()
})

test('invalid datetime is ignored', async () => {
  const { factory, restore } = loadPlugin({
    spawn: () => {
      throw new Error('spawn should not be called')
    }
  })

  const stream = createStream()
  const plugin = factory(createApp(stream))
  plugin.start({ preferNetworkTime: false, sudo: false })

  stream.push('not-a-date')
  await new Promise(resolve => setImmediate(resolve))

  assert.match(plugin.statusMessage(), /Invalid datetime format received/)
  restore()
})

test('datetime before minimum year is ignored', async () => {
  const { factory, restore } = loadPlugin({
    spawn: () => {
      throw new Error('spawn should not be called')
    }
  })

  const stream = createStream()
  const plugin = factory(createApp(stream))
  plugin.start({ preferNetworkTime: false, sudo: false })

  stream.push('2025-12-31T23:59:59Z')
  await new Promise(resolve => setImmediate(resolve))

  assert.match(plugin.statusMessage(), /Ignoring GPS time/)
  restore()
})

test('sudo fallback is used when direct set fails', async () => {
  const spawnCalls = []
  let callIndex = 0
  const { factory, restore } = loadPlugin({
    spawn: (cmd, args) => {
      spawnCalls.push({ cmd, args })
      const child = createChild()
      process.nextTick(() => child.emit('exit', callIndex++ === 0 ? 1 : 0))
      return child
    },
    writeFileSync: () => {},
    mkdirSync: () => {}
  })

  const stream = createStream()
  const plugin = factory(createApp(stream))
  plugin.start({ preferNetworkTime: false, sudo: true })

  stream.push('2026-06-02T10:20:30Z')
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(spawnCalls.length, 2)
  assert.match(String(spawnCalls[1].args[1]), /sudo -n date/)
  restore()
})

test('future last-good time is applied on start', async () => {
  const future = '2026-12-31T00:00:00Z'
  const spawnCalls = []
  const originalNow = Date.now

  Date.now = () => new Date('2026-01-01T00:00:00Z').getTime()

  const { factory, restore } = loadPlugin({
    existsSync: () => true,
    readFileSync: (original, filePath, ...args) => {
      if (String(filePath).includes('last-good-time.json')) {
        return JSON.stringify({ datetime: future })
      }
      return original(filePath, ...args)
    },
    spawn: (cmd, args) => {
      spawnCalls.push({ cmd, args })
      const child = createChild()
      process.nextTick(() => child.emit('exit', 0))
      return child
    },
    writeFileSync: () => {},
    mkdirSync: () => {}
  })

  const stream = createStream()
  const plugin = factory(createApp(stream))
  plugin.start({ preferNetworkTime: false, sudo: false })

  await new Promise(resolve => setImmediate(resolve))

  assert.equal(spawnCalls.length, 1)
  assert.match(plugin.statusMessage(), /from last-good time/)

  Date.now = originalNow
  restore()
})

test('bacon bus stream triggers time set', async () => {
  const spawnCalls = []
  const { factory, restore } = loadPlugin({
    spawn: (cmd, args) => {
      spawnCalls.push({ cmd, args })
      const child = createChild()
      process.nextTick(() => child.emit('exit', 0))
      return child
    },
    writeFileSync: () => {},
    mkdirSync: () => {}
  })

  const bus = new Bacon.Bus()
  const app = createApp(bus)
  const plugin = factory(app)

  plugin.start({ preferNetworkTime: false, sudo: false })

  bus.push('2026-06-01T00:00:00Z')
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(spawnCalls.length, 1)
  restore()
})
