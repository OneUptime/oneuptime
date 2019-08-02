import React from 'react';
import { storiesOf } from '@storybook/react';
import App from '../App'

import { Provider } from 'react-redux';
import { state, mockStore } from './redux_mock'

localStorage.setItem('id', '5b1c0c29cb06cc23b132db07')

const store = mockStore(state)



const store_error_getstatuspage = mockStore({
    ...state,
    status: {
        ...state.status,
        error: 'Error that will occur'
    }
})

const store_error_verify = mockStore({
    ...state,
    login: {
        ...state.login,
        success: false,
        error: 'error that will occur'
    }
})

const store_public_statuspage = mockStore({
    ...state,
    status: {
        ...state.status,
        statusPage: {
            ...state.status.statusPage,
            isPrivate: false
        }
    },
    login: {
        ...state.login,
        success: false
    }
})

const store_private_status_page_no_authenticated = mockStore({
    ...state,
    status: {
        ...state.status,
        statusPage: {
            ...state.status.statusPage,
            isPrivate: true
        }
    },
    login: {
        ...state.login,
        success: false
    }
})

const store_private_status_page_authenticated = mockStore({
    ...state,
    status: {
        ...state.status,
        statusPage: {
            ...state.status.statusPage,
            isPrivate: true
        }
    },
    login: {
        ...state.login,
        success: true
    }
}

)

storiesOf('Status Page', module)
    .addDecorator(story => <Provider store={store_error_getstatuspage}>{story()}</Provider>)
    .add('Status Page Error getting Status Page', () =>
        <App />
    )
storiesOf('Status Page', module)
    .addDecorator(story => <Provider store={store_error_verify}>{story()}</Provider>)
    .add('Status Page Error verfying user', () =>
        <App />
    )
storiesOf('Status Page', module)
    .addDecorator(story => <Provider store={store_public_statuspage}>{story()}</Provider>)
    .add('Status Page Public Status Page', () =>
        <App />
    )


storiesOf('Status Page', module)
    .addDecorator(story => <Provider store={store}>{story()}</Provider>)
    .add('Status Page Not Private', () =>
        <App />
    )

storiesOf('Status Page', module)
    .addDecorator(story => <Provider store={store_private_status_page_no_authenticated}>{story()}</Provider>)
    .add('Status Page Private Status Page Failed Auth', () =>
        <App />
    )

storiesOf('Status Page', module)
    .addDecorator(story => <Provider store={store_private_status_page_authenticated}>{story()}</Provider>)
    .add('Status Page Private Status Page User verify success', () =>
        <App />
    )