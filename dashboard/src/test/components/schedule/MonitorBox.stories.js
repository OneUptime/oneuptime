import React from 'react';
import { storiesOf, action } from '@storybook/react';
import { reduxForm } from 'redux-form'
import { MonitorBox } from '../../../components/schedule/MonitorBox'

const MonitorBoxDecorated = new reduxForm({
    form: 'AddUsersForm',
    enableReinitialize: true
})(MonitorBox);

const props = {
    handleSubmit: action('submit'),
    teamLoading: action('submit'),
    monitors: []
}

const props_with_users = {
    handleSubmit: action('submit'),
    teamLoading: action('submit'),
    currentProject: {
        'id': '5b1f39482a62c8611d23c953',
        'users': [
            {
                'userId': '5b1c0c29cb06cc23b132db07',
                'role': 'Administrator',
                '_id': '5b1f39482a62c8611d23c954'
            },
            {
                'userId': '5b1d20232352d77c91b2dae1',
                'role': 'Member',
                '_id': '5b2c77fa728c4b2bc286eca4'
            }
        ],
        'createdAt': '2018-06-12T03:08:56.638Z',
        'name': 'Test 1',
        'apiKey': '403e2e10-75d9-11e8-9272-bf0bb40d80f7',
        'stripePlanId': 'plan_CpIUcLDhD1HKKA',
        'stripeSubscriptionId': 'sub_D276mFZNBg3iMK',
        'stripeMeteredSubscriptionId': 'sub_D276LWAbjABjIZ',
    },
    monitors: [
        {
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
            'time': [
              {
                'date': 'Sun Jun 24 2018 00:08:27 GMT+0530 (India Standard Time)',
                'monitorId': '5b2dc269f5e4115b698b2d73',
                'upTime': 0,
                'downTime': 0,
                'status': ''
              }
            ],
            'count': 0,
            'incidents': [],
            'skip': 0,
            'limit': 3,
            'responseTime': null,
            'uptimePercent': 100,
            'status': 'offline'
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
            'time': [
              {
                'date': 'Sun Jun 24 2018 00:08:27 GMT+0530 (India Standard Time)',
                'monitorId': '5b1f41a02a62c8611d23c96e',
                'upTime': 0,
                'downTime': 0,
                'status': ''
              }
            ],
            'count': 14,
            'incidents': [
              {
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
            'status': 'offline'
          }
    ]
}

storiesOf('Schedule', module)
    .addDecorator(story => (
        <div style={{ margin: '5%' }} >
            {story()}</div>
    ))
    .add('MonitorBox No Monitors', () =>
        <MonitorBoxDecorated  {...props} />
    )
    .add('MonitorBox With Monitors', () =>
        <MonitorBoxDecorated {...props_with_users} />
    )
    

