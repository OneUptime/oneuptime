import React from 'react';
import { storiesOf, action } from '@storybook/react';
import WebHookButton from '../../../components/webHooks/WebHookButton';

import { Provider } from 'react-redux';
import { state, mockStore } from '../../redux_mock';

const store = mockStore(state);

localStorage.setItem('access_token', 'token');

const props = {
    currentProject: {
        users: [
            {
                userId: '5b1c0c29cb06cc23b132db07',
                role: 'Administrator',
                _id: '5b5b3cd6759d8814a7162677',
            },
        ],
        createdAt: '2018-07-27T15:40:06.071Z',
        _id: '5b5b3cd6759d8814a7162676',
        name: 'Test',
        apiKey: '55e00b80-91b3-11e8-bfeb-a367ac6590d9',
        stripePlanId: 'plan_CpIZEEfT4YFSvF',
        stripeSubscriptionId: 'sub_DJANP4LyBQh84J',
        stripeMeteredSubscriptionId: 'sub_DJANLxwb0jK9An',
        __v: 0,
    },
    openModal: action('openModal'),
};

storiesOf('WebHook', module)
    .addDecorator(story => <Provider store={store}>{story()}</Provider>)
    .addDecorator(story => <div style={{ margin: '5%' }}>{story()}</div>)
    .add('WebHook Button', () => <WebHookButton {...props} />);
