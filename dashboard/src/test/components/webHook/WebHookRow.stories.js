import React from 'react';
import { storiesOf } from '@storybook/react';
import {
    WebHookBadgeTableBody,
    WebHookTableBody,
    WebHookTableHeader,
} from '../../../components/webHooks/WebHookRow';

import { Provider } from 'react-redux';
import { state, mockStore } from '../../redux_mock';

localStorage.setItem('id', '5b1c0c29cb06cc23b132db07');
const store = mockStore(state);

const props = {
    text: 'Hello',
    primary: true,
};

storiesOf('WebHook', module)
    .addDecorator(story => <Provider store={store}>{story()}</Provider>)
    .addDecorator(story => <div style={{ margin: '5%' }}>{story()}</div>)
    .add('WebHook Badge Table Body', () => (
        <WebHookBadgeTableBody text="hello" />
    ))
    .add('WebHook Table Body', () => <WebHookTableBody {...props} />)
    .add('WebHook Table Header', () => <WebHookTableHeader text="hello" />);
