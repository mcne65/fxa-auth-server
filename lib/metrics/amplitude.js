/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// This module contains mappings from activity/flow event names to
// amplitude event definitions. The intention is for the returned
// `receiveEvent` function to be invoked for every event and the
// mappings determine which of those will be transformed into an
// amplitude event.
//
// You can read more about the amplitude event structure here:
//
// https://amplitude.zendesk.com/hc/en-us/articles/204771828-HTTP-API
//
// You can see the event taxonomy here:
//
// https://docs.google.com/spreadsheets/d/1G_8OJGOxeWXdGJ1Ugmykk33Zsl-qAQL05CONSeD4Uz4

'use strict'

const APP_VERSION = /^[0-9]+\.([0-9]+)\./.exec(require('../../package.json').version)[1]

const GROUPS = {
  activity: 'fxa_activity',
  email: 'fxa_email',
  login: 'fxa_login',
  registration: 'fxa_reg',
  sms: 'fxa_sms'
}

const EVENTS = {
  'account.confirmed': {
    group: GROUPS.login,
    event: 'email_confirmed'
  },
  'account.created': {
    group: GROUPS.registration,
    event: 'created'
  },
  'account.login': {
    group: GROUPS.login,
    event: 'success'
  },
  'account.login.blocked': {
    group: GROUPS.login,
    event: 'blocked'
  },
  'account.login.confirmedUnblockCode': {
    group: GROUPS.login,
    event: 'unblock_success'
  },
  'account.reset': {
    group: GROUPS.login,
    event: 'forgot_complete'
  },
  'account.signed': {
    group: GROUPS.activity,
    event: 'cert_signed'
  },
  'account.verified': {
    group: GROUPS.registration,
    event: 'email_confirmed'
  },
  'flow.complete': {
    isDynamicGroup: true,
    group: (request, data, metricsContext) => GROUPS[metricsContext.flowType],
    event: 'complete'
  },
  'sms.installFirefox.sent': {
    group: GROUPS.sms,
    event: 'sent'
  }
}

const EMAIL_EVENTS = /^email\.(\w+)\.(bounced|sent)$/

const EMAIL_TYPES = {
  newDeviceLoginEmail: 'login',
  passwordChangedEmail: 'change_password',
  passwordResetEmail: 'reset_password',
  passwordResetRequiredEmail: 'reset_password',
  postRemoveSecondaryEmail: 'secondary_email',
  postVerifyEmail: 'registration',
  postVerifySecondaryEmail: 'secondary_email',
  recoveryEmail: 'reset_password',
  unblockCode: 'unblock',
  verificationReminderFirstEmail: 'registration',
  verificationReminderSecondEmail: 'registration',
  verificationReminderEmail: 'registration',
  verifyEmail: 'registration',
  verifyLoginEmail: 'login',
  verifySyncEmail: 'registration',
  verifySecondaryEmail: 'secondary_email'
}

const NOP = () => {}

const EVENT_PROPERTIES = {
  [GROUPS.activity]: NOP,
  [GROUPS.email]: mapEmailType,
  [GROUPS.login]: NOP,
  [GROUPS.registration]: NOP,
  [GROUPS.sms]: NOP
}

const USER_PROPERTIES = {
  [GROUPS.activity]: mapUid,
  [GROUPS.email]: mapUid,
  [GROUPS.login]: mapUid,
  [GROUPS.registration]: mapUid,
  [GROUPS.sms]: NOP
}

module.exports = log => {
  if (log) {
    return receiveEvent
  }

  function receiveEvent (event, request, data = {}, metricsContext = {}) {
    if (! event || ! request) {
      log.error({ op: 'amplitudeMetrics', err: 'Bad argument', event, hasRequest: !! request })
      return
    }

    let mapping = EVENTS[event]

    if (! mapping) {
      const matches = EMAIL_EVENTS.exec(event)
      if (matches) {
        const eventCategory = matches[1]
        if (EMAIL_TYPES[eventCategory]) {
          mapping = {
            group: GROUPS.email,
            event: matches[2],
            eventCategory: matches[1]
          }
        }
      }
    }

    if (mapping) {
      let group = mapping.group
      if (mapping.isDynamicGroup) {
        group = group(request, data, metricsContext)
        if (! group) {
          return
        }
      }
      if (mapping.eventCategory) {
        data.eventCategory = mapping.eventCategory
      }
      log.amplitudeEvent({
        time: metricsContext.time || Date.now(),
        user_id: getUid(request, data),
        device_id: getDeviceId(request, metricsContext),
        event_type: `${group} - ${mapping.event}`,
        session_id: getFromMetricsContext(metricsContext, 'flowBeginTime', request, 'flowBeginTime'),
        event_properties: mapEventProperties(group, request, data, metricsContext),
        user_properties: mapUserProperties(group, request, data, metricsContext),
        app_version: APP_VERSION,
        language: request.app.locale || undefined
      })
    }
  }
}

function getUid (request, data) {
  return data.uid || getFromToken(request, 'uid')
}

function getFromToken (request, key) {
  if (request.auth.credentials) {
    return request.auth.credentials[key]
  }
}

function getDeviceId (request, metricsContext) {
  return getFromMetricsContext(metricsContext, 'device_id', request, 'deviceId')
}

function getFromMetricsContext (metricsContext, key, request, payloadKey) {
  return metricsContext[key] ||
    (request.payload.metricsContext && request.payload.metricsContext[payloadKey])
}

function mapEventProperties (group, request, data, metricsContext) {
  return Object.assign({
    device_id: getDeviceId(request, metricsContext),
    service: data.service || request.query.service || request.payload.service
  }, EVENT_PROPERTIES[group](request, data, metricsContext))
}

function mapEmailType (request, data) {
  const emailType = EMAIL_TYPES[data.eventCategory]
  if (emailType) {
    return {
      email_type: emailType
    }
  }
}

function mapUserProperties (group, request, data, metricsContext) {
  const { browser, browserVersion, os } = request.app.ua
  return Object.assign({
    flow_id: getFromMetricsContext(metricsContext, 'flow_id', request, 'flowId'),
    ua_browser: browser,
    ua_version: browserVersion,
    ua_os: os
  }, USER_PROPERTIES[group](request, data, metricsContext))
}

function mapUid (request, data) {
  return {
    fxa_uid: getUid(request, data)
  }
}

