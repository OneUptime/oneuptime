import React from 'react';
import { storiesOf } from '@storybook/react';
import IsMember from '../../../components/basic/IsMember';

localStorage.setItem('id', '5b1c0c29cb06cc23b132db07');

const currentProject_1 = {
    id: '5b1f39482a62c8611d23c953',
    users: [
        {
            userId: '5b1c0c29cb06cc23b132db07',
            role: 'Administrator',
            _id: '5b1f39482a62c8611d23c954',
        },
        {
            userId: '5b1d20232352d77c91b2dae1',
            role: 'Administrator',
            _id: '5b2c77fa728c4b2bc286eca4',
        },
    ],
    createdAt: '2018-06-12T03:08:56.638Z',
    name: 'Test 1',
    apiKey: '403e2e10-75d9-11e8-9272-bf0bb40d80f7',
    stripePlanId: 'plan_CpIUcLDhD1HKKA',
    stripeSubscriptionId: 'sub_D276mFZNBg3iMK',
    stripeMeteredSubscriptionId: 'sub_D276LWAbjABjIZ',
};

const currentProject_2 = {
    id: '5b1f39482a62c8611d23c953',
    users: [
        {
            userId: '5b1d20232352d77c91b2dae1',
            role: 'Administrator',
            _id: '5b1f39482a62c8611d23c954',
        },
        {
            userId: '5b1c0c29cb06cc23b132db07',
            role: 'Member',
            _id: '5b2c77fa728c4b2bc286eca4',
        },
    ],
    createdAt: '2018-06-12T03:08:56.638Z',
    name: 'Test 1',
    apiKey: '403e2e10-75d9-11e8-9272-bf0bb40d80f7',
    stripePlanId: 'plan_CpIUcLDhD1HKKA',
    stripeSubscriptionId: 'sub_D276mFZNBg3iMK',
    stripeMeteredSubscriptionId: 'sub_D276LWAbjABjIZ',
};

storiesOf('Basic', module)
    .addDecorator(story => (
        <div id="login" className="register-page" style={{ overflow: 'auto' }}>
            <div style={{ margin: '20%' }}>{story()}</div>
        </div>
    ))
    .add('IsMember False', () => (
        <span>
            {IsMember(currentProject_1)
                ? 'Returned true, User Is Member'
                : 'Returned false, User Is not Member'}
        </span>
    ))
    .add('IsMember True', () => (
        <span>
            {IsMember(currentProject_2)
                ? 'Returned true, User Is Member'
                : 'Returned false, User Is not Member'}
        </span>
    ));
