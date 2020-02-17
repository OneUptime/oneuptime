import React from 'react';
import { storiesOf, action } from '@storybook/react';
import { IncidentInvestigation } from '../../../components/incident/IncidentInvestigation'

const mock_setData = (details)=>{
    const submitAction = action('setdata');
  submitAction(details);
}


const props = {
    'incident': {
        'acknowledged': false,
        'resolved': false,
        'internalNote': '',
        'investigationNote': '',
        'createdAt': '2018-06-22T16:57:54.908Z',
        '_id': '5b2d2a92f5e4115b698b2cff',
        'monitorId': {
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
            '__v': 0
        },
        'createdBy': {
            'onCallAlert': ['sms', 'call', 'email'],
            'createdAt': '2018-06-09T17:19:37.071Z',
            'lastActive': '2018-06-26T05:51:32.462Z',
            '_id': '5b1c0c29cb06cc23b132db07',
            'name': 'Danstan Onyango',
            'email': 'danstan.otieno@gmail.com',
            'password': '$2b$10$fmiv2VC7T/91T9SGsQ1Gc.iAI3El70k/na5eDvE31qNGVVrEY1V4K',
            'companyName': 'Zemuldo',
            'companyRole': 'Geek',
            'referral': 'Am with u',
            'companyPhoneNumber': '+254728554638',
            'coupon': null,
            'jwtRefreshToken': 'va564HNikaSBrDOgPofqWRe5sKzK5LwPRsnwptVh7NeIq4mXr9QrNJh8aU1AP9hTvpdDRsbN2mrfnJJQWrAQxaojN9KncLXtM9L4TPG6eg4q2J5LoQCpnQDG6MfQcRe9bV0SwXQ6y9YaL8l0ZrslVG3m6ikmcFoC6Nxx69Pr6aNvFltn4dLlk4PS0Px3kQNRDThvpGgybs3NfpyXzoGUiQTeRdHmNNnYdd4Uvd1B2ZUUr2vmJGSnrmgb51bbL6Nk',
            'stripeCustomerId': 'cus_D1D9mLILlq66ev',
            '__v': 0,
            'profilePic': '1ddaf17a9c1a532865ff41f293117226.png',
            'timezone': 'Alaska (GMT -09:00)',
            'resetPasswordExpires': '1529658748197',
            'resetPasswordToken': '3809e41fea639b365f81542cabb88495c9586087'
        },
        '__v': 0
    },
    'request': false,
    setdata:mock_setData
}


storiesOf('Incidents', module)
    .addDecorator(story => (
        <div style={{ margin: '3%' }} >
            {story()}</div>
    ))
    .add('IncidentInvestigation', () =>
        <IncidentInvestigation {...props}/>
    )