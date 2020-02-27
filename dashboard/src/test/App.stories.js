import React from 'react';
import { storiesOf } from '@storybook/react';
import App from '../App';

import { Provider } from 'react-redux';
import { state, mockStore } from './redux_mock';

localStorage.setItem('id', '5b1c0c29cb06cc23b132db07');

const store = mockStore(state);

storiesOf('App', module)
    .addDecorator(story => <Provider store={store}>{story()}</Provider>)
    .add('App 404', () => <App />);
