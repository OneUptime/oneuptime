import React from 'react';
import { storiesOf, action } from '@storybook/react';
import EditWebhook from '../../../components/modals/EditWebhook';
const props = {
    'currentProject': {
        'users': [{
            'userId': '5b1c0c29cb06cc23b132db07',
            'role': 'Administrator',
            '_id': '5b5b3cd6759d8814a7162677'
        }],
        'createdAt': '2018-07-27T15:40:06.071Z',
        '_id': '5b5b3cd6759d8814a7162676',
        'name': 'Test',
        'apiKey': '55e00b80-91b3-11e8-bfeb-a367ac6590d9',
        'stripePlanId': 'plan_CpIZEEfT4YFSvF',
        'stripeSubscriptionId': 'sub_DJANP4LyBQh84J',
        'stripeMeteredSubscriptionId': 'sub_DJANLxwb0jK9An',
        '__v': 0
    },
    'data': {
        'monitors': [{
                'createdAt': '2018-09-25T07:17:22.109Z',
                'pollTime': '2018-09-25T16:12:21.716Z',
                'updateTime': '2018-09-25T07:17:22.109Z',
                '_id': '5ba9e102135d59258e5537b5',
                'createdBy': '5b9283dbc5d4132324cd92e1',
                'name': 'Unizonn',
                'type': 'url',
                'data': {
                    'url': 'http://unizon.co.uk'
                },
                'projectId': '5b9283e1c5d4132324cd92e2',
                '__v': 0
            },
            {
                'createdAt': '2018-09-24T11:05:31.577Z',
                'pollTime': '2018-09-25T16:12:21.716Z',
                'updateTime': '2018-09-24T11:05:31.577Z',
                '_id': '5ba8c4fb70db043291facc8b',
                'createdBy': '5b9283dbc5d4132324cd92e1',
                'name': 'Test 2',
                'type': 'url',
                'data': {
                    'url': 'http://sjdshdjhdjshdj.com'
                },
                'projectId': '5b9283e1c5d4132324cd92e2',
                '__v': 0
            }
        ],
        '_id': '5baa16d7257dac3486eeab7e',
        'projectId': {
            'users': [{
                'userId': '5b9283dbc5d4132324cd92e1',
                'role': 'Administrator',
                '_id': '5b9283e1c5d4132324cd92e3'
            }],
            'createdAt': '2018-09-07T13:57:53.039Z',
            '_id': '5b9283e1c5d4132324cd92e2',
            'name': 'Demo Project',
            'apiKey': '03a74810-b2a6-11e8-968d-bd7238e8faae',
            'stripePlanId': 'plan_CpIUcLDhD1HKKA',
            'stripeSubscriptionId': 'sub_DYsDt2GNgkhCtg',
            'stripeMeteredSubscriptionId': 'sub_DYsDZuTuf6YnuU',
            '__v': 0
        },
        'createdBy': {
            'onCallAlert': [],
            'createdAt': '2018-09-07T13:57:47.747Z',
            'lastActive': '2018-09-25T16:12:37.921Z',
            '_id': '5b9283dbc5d4132324cd92e1',
            'name': 'Rex Raphael',
            'email': 'juicycleff@gmail.com',
            'password': '$2b$10$HxIjRcTEa441YPZNp3bt.etH7KQkLdo4wlPXjxwruxefetAqV6B/.',
            'companyName': 'Boldsofts',
            'companyRole': 'Boldsofts',
            'referral': 'Google',
            'companyPhoneNumber': '+2348162611815',
            'coupon': null,
            'jwtRefreshToken': '5i9FGzQWkFlXutLsCud0lyoAlOmVVrXJcI8kFtC84ViqXkTBug8IOHWxquhnFy1w9kK323OhUm32lsMyfAW8mIzQisnenD184HhzWqcbBPmeQJ36YX4qpRzBruYesKvMsRNcRNwIC9UdmxwAduP2T9FZKOFB1DChjYttPk5jJkdWzZDsKI9OAToO1tbQDskm3gpxuhhXLRxh40P7qcP4bEQcQetjVq9vtwvouMDbPGZuLYO1Iuq7xgp74H7fCrbJ',
            'stripeCustomerId': 'cus_DYsD7P2LbpMwsb',
            '__v': 0
        },
        'integrationType': 'webhook',
        'data': {
            'userId': '5b9283dbc5d4132324cd92e1',
            'endpoint': 'http://localhost:3002/webhook/test',
            'monitorIds': [
                '5ba9e102135d59258e5537b5'
            ]
        },
    },
    updateWebHook: action('updateWebHook'),
    closeThisDialog: action('closeThisDialog')
}


storiesOf('Modals', module)
    .addDecorator(story => (
        <div style={{ margin: '20%' }} >
            {story()}</div>
    ))
    .add('EditMonitor', () =>
        <EditWebhook  {...props} />
    )
