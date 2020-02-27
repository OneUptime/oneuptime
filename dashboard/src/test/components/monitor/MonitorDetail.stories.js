import React from 'react';
import { storiesOf, action } from '@storybook/react';
import { MonitorDetail } from '../../../components/monitor/MonitorDetail';

import { Provider } from 'react-redux';
import { state, mockStore } from '../../redux_mock';

localStorage.setItem('id', '5b1c0c29cb06cc23b132db07');

const store = mockStore(state);

const props = {
    monitor: {
        createdAt: '2018-06-12T03:44:32.892Z',
        pollTime: '2018-06-12T03:44:32.892Z',
        _id: '5b1f41a02a62c8611d23c96e',
        createdBy: '5b1c0c29cb06cc23b132db07',
        name: 'Home Page',
        type: 'url',
        data: {
            url: 'https://hackerbay.io',
        },
        projectId: '5b1f39482a62c8611d23c953',
        __v: 0,
        time: [
            {
                date: 'Tue Jun 26 2018 02:24:10 GMT+0530 (India Standard Time)',
                monitorId: '5b1f41a02a62c8611d23c96e',
                upTime: 0,
                downTime: 0,
                status: '',
            },
        ],
        count: 14,
        incidents: [
            {
                acknowledged: false,
                resolved: false,
                internalNote: '',
                investigationNote: '',
                createdAt: '2018-06-22T16:57:54.908Z',
                _id: '5b2d2a92f5e4115b698b2cff',
                monitorId: '5b1f41a02a62c8611d23c96e',
                createdBy: '5b1c0c29cb06cc23b132db07',
                __v: 0,
            },
            {
                acknowledged: false,
                resolved: false,
                internalNote: '',
                investigationNote: '',
                createdAt: '2018-06-22T16:57:54.190Z',
                _id: '5b2d2a92f5e4115b698b2cfe',
                monitorId: '5b1f41a02a62c8611d23c96e',
                createdBy: '5b1c0c29cb06cc23b132db07',
                __v: 0,
            },
            {
                acknowledged: false,
                resolved: false,
                internalNote: '',
                investigationNote: '',
                createdAt: '2018-06-22T16:57:53.522Z',
                _id: '5b2d2a91f5e4115b698b2cfd',
                monitorId: '5b1f41a02a62c8611d23c96e',
                createdBy: '5b1c0c29cb06cc23b132db07',
                __v: 0,
            },
        ],
        skip: 0,
        limit: 3,
        responseTime: null,
        uptimePercent: 100,
        status: 'offline',
        error: null,
        success: false,
        requesting: false,
    },
    index: 0,
    monitorState: {
        monitorsList: {
            requesting: false,
            error: null,
            success: false,
            monitors: [
                {
                    createdAt: '2018-07-27T15:40:57.831Z',
                    pollTime: '2018-07-27T15:40:57.831Z',
                    updateTime: '2018-07-27T15:40:57.831Z',
                    _id: '5b5b3d09759d8814a7162679',
                    createdBy: '5b1c0c29cb06cc23b132db07',
                    name: 'Home Page',
                    type: 'url',
                    data: {
                        url: 'https://hackerbay.io',
                    },
                    projectId: '5b5b3cd6759d8814a7162676',
                    __v: 0,
                },
            ],
        },
        newMonitor: {
            requesting: false,
            error: null,
            success: false,
            monitor: null,
        },
        editMonitor: {
            error: null,
            requesting: false,
            success: false,
        },
        fetchMonitorsIncidentRequest: false,
    },
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
    fetchMonitorsIncidents: action('fetchMonitorsIncidents'),
    editMonitorSwitch: action('editMonitorSwitch'),
    deleteMonitor: action('deleteMonitor'),
    openModal: action('openModal'),
};

const state_non_admin = {
    ...state,
    project: {
        ...state.project,
        currentProject: {
            ...state.project.currentProject,
            users: [
                {
                    userId: '5b1c0c29cb06cc23b132db07',
                    role: 'Member',
                    _id: '5b1f39482a62c8611d23c954',
                },
                {
                    userId: '5b1d20232352d77c91b2dae1',
                    role: 'Member',
                    _id: '5b2c77fa728c4b2bc286eca4',
                },
            ],
        },
    },
};

const store_non_admin = mockStore(state_non_admin);

storiesOf('Monitor', module)
    .addDecorator(story => <Provider store={store}>{story()}</Provider>)
    .addDecorator(story => <div style={{ margin: '5%' }}>{story()}</div>)
    .add('Monitor Detail', () => <MonitorDetail {...props} />);

storiesOf('Monitor', module)
    .addDecorator(story => (
        <Provider store={store_non_admin}>{story()}</Provider>
    ))
    .addDecorator(story => <div style={{ margin: '5%' }}>{story()}</div>)
    .add('Monitor Detail Non Admin', () => <MonitorDetail {...props} />);
