import { consola } from 'consola'
import WebSocket from 'ws'
import { $api } from './data.mjs'

const CF_LOG_OUTCOMES = {
  ok: 'OK',
  canceled: 'Canceled',
  exceededCpu: 'Exceeded CPU Limit',
  exceededMemory: 'Exceeded Memory Limit',
  exception: 'Exception Thrown',
  unknown: 'Unknown'
}


export async function createLogs(projectSlug, teamSlug, env) {
  return await $api(`/teams/${teamSlug}/projects/${projectSlug}/${env}/logs`)
}

export async function deleteLogs(projectSlug, teamSlug, env, id) {
  return await $api(`/teams/${teamSlug}/projects/${projectSlug}/${env}/logs/${id}`, {
    method: 'DELETE'
  })
}

export function connectLogs(url, debug = false) {
  const tail = new WebSocket(url, 'trace-v1', {
    headers: {
      'Sec-WebSocket-Protocol': 'trace-v1', // needs to be `trace-v1` to be accepted
      'User-Agent': `nuxt-hub/${11}`,
    },
  })

  // send filters when we open up
  tail.on('open', () => {
    tail.send(
      JSON.stringify({ debug: debug }),
      { binary: false, compress: false, mask: false, fin: true },
      (err) => {
        if (err) {
          throw err
        }
      }
    )
  })

  return tail
}

export function printFormattedLog(log) {
  log = JSON.parse(log.toString())
  const outcome = CF_LOG_OUTCOMES[log.outcome] || CF_LOG_OUTCOMES.unknown

  // Request
  if ('request' in log.event) {
    const { request: { method, url }, response: { status } } = log.event
    const datetime = new Date(log.eventTimestamp).toLocaleString()

    consola.log(
      url
        ? `${method.toUpperCase()} ${url} - ${outcome} ${status} @${datetime}`
        : `[missing request] - ${outcome} @${datetime}`
    )
    return
  }

  // Cron
  if ('cron' in log.event) {
    const cronPattern = log.event.cron
    const datetime = new Date(log.event.scheduledTime).toLocaleString()
    const outcome = log.outcome

    consola.log(`"${cronPattern}" @${datetime} - ${outcome}`)
    return
  }

  // Email
  if ('mailFrom' in log.event) {
    const datetime = new Date(log.eventTimestamp).toLocaleString()
    const mailFrom = log.event.mailFrom
    const rcptTo = log.event.rcptTo
    const rawSize = log.event.rawSize

    consola.log(`Email from:${mailFrom} to:${rcptTo} size:${rawSize} @${datetime} - ${outcome}`)
    return
  }

  // Alarm
  if ('scheduledTime' in log.event && !('cron' in log.event)) {
    const datetime = new Date(log.event.scheduledTime).toLocaleString()
    consola.log(`Alarm @${datetime} - ${outcome}`)
    return
  }

  // Tail Event
  if ('consumedEvents' in log.event) {
    const datetime = new Date(log.eventTimestamp).toLocaleString()
    const tailedScripts = new Set(
      log.event.consumedEvents
        .map((consumedEvent) => consumedEvent.scriptName)
        .filter((scriptName) => !!scriptName)
    )

    consola.log(`Tailing ${Array.from(tailedScripts).join(',')} - ${outcome} @${datetime}`)
    return
  }

  // Tail Info
  if ('message' in log.event && 'type' in log.event) {
    if (log.event.type === 'overload') {
      consola.log(log.event.message)
    } else if (log.event.type === 'overload-stop') {
      consola.log(log.event.message)
    }
    return
  }

  // Queue
  if ('queue' in log.event) {
    const datetime = new Date(log.eventTimestamp).toLocaleString()
    const queueName = log.event.queue
    const batchSize = log.event.batchSize
    const batchSizeMsg = `${batchSize} message${batchSize !== 1 ? 's' : ''}`

    consola.log(`Queue ${queueName} (${batchSizeMsg}) - ${outcome} @${datetime}`)
    return
  }

  // Unknown event type
  const datetime = new Date(log.eventTimestamp).toLocaleString()
  consola.log(`Unknown Event - ${outcome} @${datetime}`)

  // Print console logs and exceptions
  if (log.logs.length > 0) {
    log.logs.forEach(({ level, message }) => {
      consola.log(`  (${level})`, ...message)
    })
  }

  if (log.exceptions.length > 0) {
    log.exceptions.forEach(({ name, message }) => {
      consola.error(`  ${name}:`, message)
    })
  }
}