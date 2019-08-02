import React from 'react';
import {storiesOf} from '@storybook/react';
import {SidebarNavItem} from '../../../components/nav/SideNavItem'
import { action } from '@storybook/addon-actions';

localStorage.setItem('id', '5b1c0c29cb06cc23b132db07')

let routes = [
    {
        'title': 'Project Settings',
        'path': '/project/:projectId/settings',
        'icon': 'businessSettings',
        'visible': true,
        'subRoutes': [],
        'index': 2
    },
    {
        title: 'Status Page',
        path: '/project/:projectId/status-page',
        icon: 'radar',
        visible: true,
        subRoutes: [],
        index: 2
    }
]

const props = {
    'match': {
        'path': '/project/:projectId/monitoring',
        'url': '/project/5b1f39482a62c8611d23c953/monitoring',
        'isExact': true,
        'params': {
            'projectId': '5b1f39482a62c8611d23c953'
        }
    },
    'location': {
        'pathname': '/project/5b1f39482a62c8611d23c953/monitoring',
        'search': '',
        'hash': '',
        'key': 'tv4t6v'
    },
    'history': {
        'length': 50,
        push: action('Push History'),
        'location': {
            'pathname': '/project/5b1f39482a62c8611d23c953/monitoring',
            'search': '',
            'hash': '',
            'key': 'tv4t6v'
        }
    },
    'currentProject': {
        'users': [{
            'userId': '5b1c0c29cb06cc23b132db07',
            'role': 'Administrator',
            '_id': '5b1f39482a62c8611d23c954'
        }, {
            'userId': '5b1d20232352d77c91b2dae1',
            'role': 'Administrator',
            '_id': '5b2c77fa728c4b2bc286eca4'
        }],
        'createdAt': '2018-06-12T03:08:56.638Z',
        '_id': '5b1f39482a62c8611d23c953',
        'name': 'Test 1',
        'apiKey': '403e2e10-75d9-11e8-9272-bf0bb40d80f7',
        'stripePlanId': 'plan_CpIUcLDhD1HKKA',
        'stripeSubscriptionId': 'sub_D276mFZNBg3iMK',
        'stripeMeteredSubscriptionId': 'sub_D276LWAbjABjIZ',
        '__v': 0
    },
    'schedule': {
        'userIds': [{
            '_id': '5b1c0c29cb06cc23b132db07',
            'name': 'Danstan Onyango'
        }, {
            '_id': '5b1d20232352d77c91b2dae1',
            'name': 'Danstan Onyango'
        }],
        'monitorIds': [{
            '_id': '5b1f41a02a62c8611d23c96e',
            'name': 'Home Page'
        }],
        'createdAt': '2018-06-22T18:49:01.285Z',
        '_id': '5b2d449df5e4115b698b2d59',
        'name': 'Test',
        'createdBy': {
            '_id': '5b1c0c29cb06cc23b132db07',
            'name': 'Danstan Onyango'
        },
        'projectId': {
            '_id': '5b1f39482a62c8611d23c953',
            'name': 'Test 1'
        },
        '__v': 0
    }
}
storiesOf('Nav', module)
    .addDecorator(story => (
        <div  style={{ overflow: 'auto' }} >
            <div style={{ margin: '10%' }} >
                {story()}</div>
        </div>
    ))
    .add('SideNavItem Project Settings', () =>
        <SidebarNavItem route= {routes[0]} {...props} />
    )
    .add('SideNavItem Status Page', () =>
        <SidebarNavItem route= {routes[1]} {...props} />
    )