import React from 'react';
import { storiesOf, action } from '@storybook/react';
import NewMonitor from '../../../components/monitor/NewMonitor'

import { Provider } from 'react-redux';
import { state, mockStore } from '../../redux_mock'

localStorage.setItem('id', '5b1c0c29cb06cc23b132db07')

const current_state = {
    ...state,
    monitor: {
        'monitorsList': {
            'requesting': false,
            'error': null,
            'success': false,
            'monitors': [{
                'createdAt': '2018-07-27T15:40:57.831Z',
                'pollTime': '2018-07-27T15:40:57.831Z',
                'updateTime': '2018-07-27T15:40:57.831Z',
                '_id': '5b5b3d09759d8814a7162679',
                'createdBy': '5b1c0c29cb06cc23b132db07',
                'name': 'Home Page',
                'type': 'url',
                'data': {
                    'url': 'https://hackerbay.io'
                },
                'projectId': '5b5b3cd6759d8814a7162676',
                '__v': 0
            }]
        },
        'newMonitor': {
            'requesting': true,
            'error': null,
            'success': false,
            'monitor': null
        },
        'editMonitor': {
            'error': null,
            'requesting': false,
            'success': false
        },
        'fetchMonitorsIncidentRequest': false
    }
}

let state_requesting = {
    ...current_state,
    monitor: {
        ...current_state.monitor,
        'editMonitor': {
            'error': null,
            'requesting': true,
            'success': false
        }
    }
}

let state_error = {
    ...current_state,
    monitor: {
        ...current_state.monitor,
        'editMonitor': {
            'error': 'error occurred',
            'requesting': true,
            'success': false
        }
    }
}

const store = mockStore(current_state)

const store_requesting = mockStore(state_requesting)

const store_error = mockStore(state_error)

const props = {
    index: 0,
    fetchMonitorsIncidents: action('fetchMonitorsIncidents'),
    editMonitorSwitch: action('editMonitorSwitch'),
    deleteMonitor: action('deleteMonitor'),
    openModal: action('openModal'),
    edit: true
}

storiesOf('Monitor', module)
    .addDecorator(story => <Provider store={store}>{story()}</Provider>)

    .addDecorator(story => (
        <div style={{ margin: '5%' }} >
            {story()}
        </div>
    ))
    .add('NewMonitor', () =>
        <NewMonitor {...props} />
    )
storiesOf('Monitor', module)
    .addDecorator(story => <Provider store={store_requesting}>{story()}</Provider>)

    .addDecorator(story => (
        <div style={{ margin: '5%' }} >
            {story()}
        </div>
    ))

    .add('NewMonitor Requesting', () =>
        <NewMonitor {...props} />
    )
storiesOf('Monitor', module)
    .addDecorator(story => <Provider store={store_error}>{story()}</Provider>)

    .addDecorator(story => (
        <div style={{ margin: '5%' }} >
            {story()}
        </div>
    ))

    .add('NewMonitor Error', () =>
        <NewMonitor {...props} />
    )

