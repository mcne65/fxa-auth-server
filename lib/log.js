/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const EventEmitter = require('events').EventEmitter
const util = require('util')
const mozlog = require('mozlog')
const config = require('../config')
const logConfig = config.get('log')


function Lug(options) {
  EventEmitter.call(this)
  this.name = options.name || 'fxa-auth-server'
  mozlog.config({
    app: this.name,
    level: options.level,
    stream: options.stderr || process.stderr,
    fmt: options.fmt
  })
  this.logger = mozlog()

  this.stdout = options.stdout || process.stdout

  this.notifier = require('./notifier')(this)
}
util.inherits(Lug, EventEmitter)

Lug.prototype.close = function() {
}

// Expose the standard error/warn/info/debug/etc log methods.

Lug.prototype.trace = function (data) {
  this.logger.debug(data.op, data)
}

Lug.prototype.error = function (data) {
  // If the error object contains an email address,
  // lift it into top-level fields so that our
  // PII-scrubbing tool is able to find it.
  if (data.err && data.err.email) {
    if (! data.email) {
      data.email = data.err.email
    }
    data.err.email = null
  }
  this.logger.error(data.op, data)
}

Lug.prototype.fatal = function (data) {
  this.logger.critical(data.op, data)
}

Lug.prototype.warn = function (data) {
  this.logger.warn(data.op, data)
}

Lug.prototype.info = function (data) {
  this.logger.info(data.op, data)
}

Lug.prototype.begin = function (op, request) {
  this.logger.debug(op)
}

Lug.prototype.stat = function (stats) {
  this.logger.info('stat', stats)
}

// Log a request summary line.
// This gets called once for each compelted request.
// See https://mana.mozilla.org/wiki/display/CLOUDSERVICES/Logging+Standard
// for a discussion of this format and why it's used.

Lug.prototype.summary = function (request, response) {
  if (request.method === 'options') {
    return
  }

  request.emitRouteFlowEvent(response)

  var payload = request.payload || {}
  var query = request.query || {}
  var line = {
    op: 'request.summary',
    code: (response.isBoom) ? response.output.statusCode : response.statusCode,
    errno: response.errno || 0,
    rid: request.id,
    path: request.path,
    lang: request.app.acceptLanguage,
    agent: request.headers['user-agent'],
    remoteAddressChain: request.app.remoteAddressChain,
    accountRecreated: request.app.accountRecreated,
    t: Date.now() - request.info.received
  }
  line.uid = (request.auth && request.auth.credentials) ?
    request.auth.credentials.uid :
    payload.uid || query.uid || response.uid ||
    (response.source && response.source.uid) || '00'
  line.service = payload.service || query.service
  line.reason = payload.reason || query.reason
  line.redirectTo = payload.redirectTo || query.redirectTo
  line.keys = query.keys
  line.email = payload.email || query.email

  if (line.code >= 500) {
    line.trace = request.app.traced
    line.stack = response.stack
    this.error(line, response.message)
  }
  else {
    this.info(line)
  }
}


// Broadcast an event to attached services, such as sync.
// In production, these events are broadcast to relying services over SNS/SQS.
Lug.prototype.notifyAttachedServices = function (name, request, data) {
  return request.gatherMetricsContext({})
    .then(
      metricsContextData => {
        var e = {
          event: name,
          data: data
        }
        e.data.metricsContext = metricsContextData
        this.notifier.send(e)
      }
    )
}

// Log an activity metrics event.
// These events indicate key points at which a particular
// user has interacted with the service.

Lug.prototype.activityEvent = function (data) {
  if (! data || ! data.event || ! data.uid) {
    this.error({ op: 'log.activityEvent', data: data })
    return
  }

  this.logger.info('activityEvent', data)
}

// Log a flow metrics event.
// These events help understand the user's sign-in or sign-up journey.

Lug.prototype.flowEvent = function (data) {
  if (! data || ! data.event || ! data.flow_id || ! data.flow_time || ! data.time) {
    this.error({ op: 'log.flowEvent', data: data })
    return
  }

  this.logger.info('flowEvent', data)
}

Lug.prototype.amplitudeEvent = function (data) {
  if (! data || ! data.event_type || (! data.device_id && ! data.user_id)) {
    this.error({ op: 'log.amplitudeEvent', data })
    return
  }

  this.logger.info('amplitudeEvent', data)
}

module.exports = function (level, name, options) {
  if (arguments.length === 1 && typeof level === 'object') {
    options = level
    level = options.level
    name = options.name
  }
  options = options || {}
  options.name = name
  options.level = level
  options.fmt = logConfig.fmt
  var log = new Lug(options)

  log.stdout.on(
    'error',
    function (err) {
      if (err.code === 'EPIPE') {
        log.emit('error', err)
      }
    }
  )

  return log
}
