import React from 'react';
import { storiesOf } from '@storybook/react';
import WebHookBox from '../../../components/webHooks/WebHookBox';

import { Provider } from 'react-redux';
import { state, mockStore } from '../../redux_mock';

const store = mockStore(state);

const props = {
    match: {
        path: '/slack/:projectId/integrations',
        url: '/slack/5b5b3cd6759d8814a7162676/integrations',
        isExact: true,
        params: {
            projectId: '5b5b3cd6759d8814a7162676',
        },
    },
};

storiesOf('WebHook', module)
    .addDecorator(story => <Provider store={store}>{story()}</Provider>)
    .addDecorator(story => <div style={{ margin: '5%' }}>{story()}</div>)
    .add('WebHook Container box', () => <WebHookBox {...props} />);
