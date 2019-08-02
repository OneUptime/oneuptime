import React from 'react';
import { storiesOf, action } from '@storybook/react';
import SlackTeamItem from '../../../components/slack/SlackTeamItem'

import { Provider } from 'react-redux';
import {state, mockStore} from '../../redux_mock'

localStorage.setItem('id', '5b1c0c29cb06cc23b132db07')
const store = mockStore(state)

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
    'team': {
        '_id': '5b9947fd82730b0ed0c48200',
        'projectId': '5b9283e1c5d4132324cd92e2',
        'createdBy': '5b9283dbc5d4132324cd92e1',
        'integrationType': 'slack',
        'data': {
            'teamId': 'T77SZHUHH',
            'channelId': 'CBUSZPNUT',
            'teamName': 'Gueva',
            'accessToken': 'xoxp-245917606595-245991995746-430319582274-1c624bec5306c36ef546768181e66954',
            'botAccessToken': 'xoxb-245917606595-430319585874-r66lbqsdLXE1OHMnpCmKzYZT', 
        },
        '__v': 0 
    },
    'deleteTeam': {
        'requesting': false,
    },
    'projectId': '5b9283e1c5d4132324cd92e2',
    'deleteSlackLink': action('deleteSlackLink'),
    'openModal': action('openModal')
}

storiesOf('Slack', module)
.addDecorator(story => <Provider store={store}>{story()}</Provider>)
    .addDecorator(story => (
        <div style={{ margin: '5%' }} >
         {story()}
        </div>
    ))
    .add('Slack team item', () =>
        <SlackTeamItem {...props} />
    )
    
