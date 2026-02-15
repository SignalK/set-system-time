import * as fs from 'fs'
import * as path from 'path'
import { execSync, spawn } from 'child_process'

type Unsubscribe = () => void

type StreamLike<T> = {
  debounceImmediate: (ms: number) => StreamLike<T>
  take: (n: number) => StreamLike<T>
  onValue: (fn: (value: T) => void) => Unsubscribe
}

type StreamBundle = {
  getSelfStream: (path: string) => StreamLike<string>
}

type AppLike = {
  error?: (msg: string) => void
  debug?: (msg: string) => void
  streambundle: StreamBundle
  getDataDirPath?: () => string
}

type PluginOptions = {
  interval?: number
  sudo?: boolean
  preferNetworkTime?: boolean
}

type Plugin = {
  id: string
  name: string
  description: string
  unsubscribes: Unsubscribe[]
  statusMessage: () => string
  schema: () => object
  start: (options?: PluginOptions) => void
  stop: () => void
  useNetworkTime: (options?: PluginOptions) => boolean
}

export = function (app: AppLike): Plugin {
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

  const plugin: Plugin = {
    unsubscribes: [],
    id: 'set-system-time',
    name: 'Set System Time',
    description:
      'Plugin that sets the system date & time from navigation.datetime delta messages',
    schema: () => ({
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
    }),
    statusMessage: () => '',
    start: () => {},
    stop: () => {},
    useNetworkTime: () => false
  }

  let count = 0
  let lastMessage = ''
  let lastGoodTime: string | null = null
  plugin.statusMessage = function () {
    return `${lastMessage} ${count > 0 ? '- system time set ' + count + ' times' : ''}`
  }

  const minimumYear = 2026
  const lastGoodGraceSeconds = 300

  function getLastGoodTimePath(): string | null {
    const dataDir = typeof app.getDataDirPath === 'function' ? app.getDataDirPath() : null
    if (!dataDir) {
      return null
    }
    return path.join(dataDir, 'last-good-time.json')
  }

  function loadLastGoodTime(): string | null {
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
      logError('Failed to read last-good time: ' + (err as Error).message)
      return null
    }
  }

  function saveLastGoodTime(datetime: string): void {
    const filePath = getLastGoodTimePath()
    if (!filePath) {
      return
    }
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, JSON.stringify({ datetime }), 'utf8')
    } catch (err) {
      logError('Failed to write last-good time: ' + (err as Error).message)
    }
  }

  function setSystemTime(datetime: string, useSudoFallback: boolean, sourceLabel: string): void {
    const dateStr = datetime.replace('T', ' ').replace(/\.\d+Z?$|Z$/, '')
    const setDate = `date -u -s "${dateStr}"`
    const label = sourceLabel ? ` (${sourceLabel})` : ''

    const child = spawn('sh', ['-c', setDate])
    child.on('exit', value => {
      if (value === 0) {
        count++
        lastGoodTime = datetime
        saveLastGoodTime(datetime)
        lastMessage = 'System time set to ' + datetime + label
        debug(lastMessage)
      } else if (useSudoFallback) {
        const sudoCommand = `if sudo -n date &> /dev/null ; then sudo ${setDate} ; else exit 3 ; fi`
        const sudoChild = spawn('sh', ['-c', sudoCommand])
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

  plugin.start = function (options?: PluginOptions) {
    lastGoodTime = loadLastGoodTime()
    let stream = app.streambundle.getSelfStream('navigation.datetime')
    if (options?.interval && options.interval > 0) {
      stream = stream.debounceImmediate(options.interval * 1000)
    } else {
      stream = stream.take(1)
    }
    if (!plugin.useNetworkTime(options) && lastGoodTime) {
      const lastGoodDate = new Date(lastGoodTime)
      if (!Number.isNaN(lastGoodDate.getTime()) && Date.now() < lastGoodDate.getTime()) {
        const useSudoFallback = options?.sudo !== false
        setSystemTime(lastGoodTime, useSudoFallback, 'from last-good time')
      }
    }
    plugin.unsubscribes.push(
      stream.onValue(function (datetime) {
        if (process.platform == 'win32') {
          console.error("Set-system-time supports only linux-like os's")
        } else {
          if (!plugin.useNetworkTime(options)) {
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
              const lastGoodMillis = lastGoodDate.getTime()
              if (
                !Number.isNaN(lastGoodMillis) &&
                parsedDate.getTime() + lastGoodGraceSeconds * 1000 < lastGoodMillis
              ) {
                lastMessage = `Ignoring GPS time (${datetime}) older than last-good time ${lastGoodTime} (grace ${lastGoodGraceSeconds}s)`
                logError(lastMessage)
                return
              }
            }
            const useSudoFallback = options?.sudo !== false
            setSystemTime(datetime, useSudoFallback, '')
          }
        }
      })
    )
  }

  plugin.useNetworkTime = (options?: PluginOptions): boolean => {
    if (options?.preferNetworkTime === true) {
      const chronyCmd = "chronyc sources 2> /dev/null | cut -c2 | grep -ce '-\\|*'"
      try {
        const output = execSync(chronyCmd, { timeout: 500 })
        const validSources = parseInt(output.toString(), 10)
        if (Number.isNaN(validSources)) {
          return false
        }
        return validSources > 0
      } catch {
        return false
      }
    }
    return false
  }

  plugin.stop = function () {
    plugin.unsubscribes.forEach(f => f())
  }

  return plugin
}
