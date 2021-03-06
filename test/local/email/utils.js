/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const assert = require('insist')
const proxyquire = require('proxyquire')
const sinon = require('sinon')
const spyLog = require('../../mocks').spyLog

const amplitude = sinon.spy()
const emailHelpers = proxyquire('../../../lib/email/utils/helpers', {
  '../../metrics/amplitude': () => amplitude
})

describe('email utils helpers', () => {
  afterEach(() => amplitude.reset())

  describe('getHeaderValue', () => {

    it('works with message.mail.headers', () => {
      const message = {
        mail: {
          headers: [{
            name: 'content-language',
            value: 'en-US'
          }]
        }
      }

      const value = emailHelpers.getHeaderValue('Content-Language', message)
      assert.equal(value, message.mail.headers[0].value)
    })


    it('works with message.headers', () => {
      const message = {
        headers: [{
          name: 'content-language',
          value: 'ru'
        }]
      }

      const value = emailHelpers.getHeaderValue('Content-Language', message)
      assert.equal(value, message.headers[0].value)
    })

  })

  describe('logEmailEventSent', () => {
    it('should check headers case-insensitively', () => {
      const mockLog = spyLog()
      const message = {
        email: 'user@example.domain',
        template: 'verifyEmail',
        headers: {
          'cOnTeNt-LaNgUaGe': 'ru'
        }
      }
      emailHelpers.logEmailEventSent(mockLog, message)
      assert.equal(mockLog.info.callCount, 1)
      assert.equal(mockLog.info.args[0][0].locale, 'ru')
    })

    it('should log an event per CC email', () => {
      const mockLog = spyLog()
      const message = {
        email: 'user@example.domain',
        ccEmails: ['noreply@gmail.com', 'noreply@yahoo.com'],
        template: 'verifyEmail'
      }
      emailHelpers.logEmailEventSent(mockLog, message)
      assert.equal(mockLog.info.callCount, 3)
      assert.equal(mockLog.info.args[0][0].domain, 'other')
      assert.equal(mockLog.info.args[1][0].domain, 'gmail.com')
      assert.equal(mockLog.info.args[2][0].domain, 'yahoo.com')
    })
  })

  it('logEmailEventSent should call amplitude correctly', () => {
    emailHelpers.logEmailEventSent(spyLog(), {
      email: 'foo@example.com',
      ccEmails: [ 'bar@example.com', 'baz@example.com' ],
      template: 'verifyEmail',
      headers: [
        { name: 'Content-Language', value: 'aaa' },
        { name: 'X-Device-Id', value: 'bbb' },
        { name: 'X-Flow-Id', value: 'ccc' },
        { name: 'X-Service-Id', value: 'ddd' },
        { name: 'X-Uid', value: 'eee' }
      ]
    })
    assert.equal(amplitude.callCount, 1)
    const args = amplitude.args[0]
    assert.equal(args.length, 4)
    assert.equal(args[0], 'email.verifyEmail.sent')
    assert.deepEqual(args[1], {
      app: {
        locale: 'aaa',
        ua: {}
      },
      auth: {},
      query: {},
      payload: {}
    })
    assert.deepEqual(args[2], {
      device_id: 'bbb',
      service: 'ddd',
      uid: 'eee'
    })
    assert.equal(args[3].flow_id, 'ccc')
    assert.ok(args[3].time > Date.now() - 1000)
  })

  it('logEmailEventFromMessage should call amplitude correctly', () => {
    emailHelpers.logEmailEventFromMessage(spyLog(), {
      email: 'foo@example.com',
      ccEmails: [ 'bar@example.com', 'baz@example.com' ],
      headers: [
        { name: 'Content-Language', value: 'a' },
        { name: 'X-Device-Id', value: 'b' },
        { name: 'X-Flow-Id', value: 'c' },
        { name: 'X-Service-Id', value: 'd' },
        { name: 'X-Template-Name', value: 'verifyLoginEmail' },
        { name: 'X-Uid', value: 'e' }
      ]
    }, 'bounced', 'gmail.com')
    assert.equal(amplitude.callCount, 1)
    const args = amplitude.args[0]
    assert.equal(args.length, 4)
    assert.equal(args[0], 'email.verifyLoginEmail.bounced')
    assert.deepEqual(args[1], {
      app: {
        locale: 'a',
        ua: {}
      },
      auth: {},
      query: {},
      payload: {}
    })
    assert.deepEqual(args[2], {
      device_id: 'b',
      service: 'd',
      uid: 'e'
    })
    assert.equal(args[3].flow_id, 'c')
  })
})
