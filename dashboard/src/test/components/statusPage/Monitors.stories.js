import React from 'react';
import { storiesOf} from '@storybook/react';
import {Monitors} from '../../../components/statusPage/Monitors'
import { action } from '@storybook/addon-actions';
import {reduxForm} from 'redux-form'
import { Validate } from '../../../config';

localStorage.setItem('id', '5b1c0c29cb06cc23b132db07')

const props = {
    'array': {},
    'anyTouched': false,
    'asyncValidating': false,
    'dirty': false,
    'form': 'StatuspageMonitors',
    'initialized': false,
    'initialValues': {},
    'invalid': false,
    'pristine': true,
    'submitting': false,
    'submitFailed': false,
    'submitSucceeded': false,
    'valid': true,
    'monitors': [{
            'createdAt': '2018-06-23T03:45:45.843Z',
            'pollTime': '2018-06-23T03:45:45.843Z',
            '_id': '5b2dc269f5e4115b698b2d73',
            'createdBy': '5b1c0c29cb06cc23b132db07',
            'name': 'Test Page',
            'type': 'url',
            'data': {
                'url': 'https://hackerbay.ios'
            },
            'projectId': '5b1f39482a62c8611d23c953',
            '__v': 0,
            'time': [{
                'date': 'Mon Jun 25 2018 13:58:58 GMT+0530 (India Standard Time)',
                'monitorId': '5b2dc269f5e4115b698b2d73',
                'upTime': 0,
                'downTime': 0,
                'status': ''
            }],
            'count': 0,
            'incidents': [],
            'skip': 0,
            'limit': 3,
            'responseTime': null,
            'uptimePercent': 100,
            'status': 'offline',
            'error': null,
            'success': false,
            'requesting': false
        },
        {
            'createdAt': '2018-06-12T03:44:32.892Z',
            'pollTime': '2018-06-12T03:44:32.892Z',
            '_id': '5b1f41a02a62c8611d23c96e',
            'createdBy': '5b1c0c29cb06cc23b132db07',
            'name': 'Home Page',
            'type': 'url',
            'data': {
                'url': 'https://hackerbay.io'
            },
            'projectId': '5b1f39482a62c8611d23c953',
            '__v': 0,
            'time': [{
                'date': 'Mon Jun 25 2018 13:58:58 GMT+0530 (India Standard Time)',
                'monitorId': '5b1f41a02a62c8611d23c96e',
                'upTime': 0,
                'downTime': 0,
                'status': ''
            }],
            'count': 14,
            'incidents': [{
                    'acknowledged': false,
                    'resolved': false,
                    'internalNote': '',
                    'investigationNote': '',
                    'createdAt': '2018-06-22T16:57:54.908Z',
                    '_id': '5b2d2a92f5e4115b698b2cff',
                    'monitorId': '5b1f41a02a62c8611d23c96e',
                    'createdBy': '5b1c0c29cb06cc23b132db07',
                    '__v': 0
                },
                {
                    'acknowledged': false,
                    'resolved': false,
                    'internalNote': '',
                    'investigationNote': '',
                    'createdAt': '2018-06-22T16:57:54.190Z',
                    '_id': '5b2d2a92f5e4115b698b2cfe',
                    'monitorId': '5b1f41a02a62c8611d23c96e',
                    'createdBy': '5b1c0c29cb06cc23b132db07',
                    '__v': 0
                },
                {
                    'acknowledged': false,
                    'resolved': false,
                    'internalNote': '',
                    'investigationNote': '',
                    'createdAt': '2018-06-22T16:57:53.522Z',
                    '_id': '5b2d2a91f5e4115b698b2cfd',
                    'monitorId': '5b1f41a02a62c8611d23c96e',
                    'createdBy': '5b1c0c29cb06cc23b132db07',
                    '__v': 0
                }
            ],
            'skip': 0,
            'limit': 3,
            'responseTime': null,
            'uptimePercent': 100,
            'status': 'offline',
            'error': null,
            'success': false,
            'requesting': false
        }
    ],
    'statusPage': {
        'setting': {
            'error': null,
            'requesting': false,
            'success': false
        },
        'monitors': {
            'error': null,
            'requesting': false,
            'success': false
        },
        'branding': {
            'error': null,
            'requesting': false,
            'success': false
        },
        'links': {
            'error': null,
            'requesting': false,
            'success': false
        },
        'logocache': {
            'data': null
        },
        'faviconcache': {
            'data': null
        },
        'error': null,
        'requesting': false,
        'success': false,
        'status': {
            'monitorIds': [],
            'links': [{
                'name': 'Test',
                'url': 'https://hackerbay.io'
            }],
            'createdAt': '2018-06-12T03:08:56.656Z',
            '_id': '5b1f39482a62c8611d23c955',
            'projectId': '5b1f39482a62c8611d23c953',
            '__v': 1,
            'copyright': '',
            'description': '',
            'faviconPath': '6f1711295c1c7da54e639b4d92037977.png',
            'logoPath': '5ff52ce39a4ccbe9d564979ecfae416e.png',
            'title': '',
            'domain': 'hackerbay.io'
        }
    },
    'currentProject': {
        'users': [{
                'userId': '5b1c0c29cb06cc23b132db07',
                'role': 'Administrator',
                '_id': '5b1f39482a62c8611d23c954'
            },
            {
                'userId': '5b1d20232352d77c91b2dae1',
                'role': 'Administrator',
                '_id': '5b2c77fa728c4b2bc286eca4'
            }
        ],
        'createdAt': '2018-06-12T03:08:56.638Z',
        '_id': '5b1f39482a62c8611d23c953',
        'name': 'Test 1',
        'apiKey': '403e2e10-75d9-11e8-9272-bf0bb40d80f7',
        'stripePlanId': 'plan_CpIUcLDhD1HKKA',
        'stripeSubscriptionId': 'sub_D276mFZNBg3iMK',
        'stripeMeteredSubscriptionId': 'sub_D276LWAbjABjIZ',
        '__v': 0
    },
    'pure': true,
    updateStatusPageMonitors:action('updateStatusPageMonitors'),
    fetchStatusPages: action('fetchStatusPages')
}

  function validate(values) {
    const errors = {};
    if (values.title) {
        if (!Validate.text(values.title)) {
            errors.title = 'Please mention title in text format .'
        }
    }
    if (values.description) {
        if (!Validate.text(values.description)) {
            errors.description = 'Please mention description in text format .'
        }
    }
    if (values.copyright) {
        if (!Validate.text(values.copyright)) {
            errors.copyright = 'Please mention copyright in text format .'
        }
    }

    return errors;
}

  let MonitorsgForm = reduxForm({
    form: 'Branding', // a unique identifier for this form
    enableReinitialize: true,
    validate // <--- validation function given to redux-for
})(Monitors);
storiesOf('Status Page', module)
    .add('Monitors', () =>
        <MonitorsgForm {...props} />
    )