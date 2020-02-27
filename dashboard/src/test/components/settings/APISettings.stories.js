import React from 'react';
import { storiesOf, action } from '@storybook/react';
import { withKnobs, boolean } from '@storybook/addon-knobs';
import { APISettings } from '../../../components/settings/APISettings';
import { MockCurrentProject } from '../../ReduxStore_Mock';

localStorage.setItem('id', '5b1c0c29cb06cc23b132db07');
const mock_resetProjectToken = projectid => {
    const submitAction = action('resetProjectToken');
    submitAction(projectid);
};

const props = {
    currentProject: {
        _id: '5b1f39482a62c8611d23c953',
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
    },
    resetProjectToken: mock_resetProjectToken,
};

storiesOf('Settings', module)
    .addDecorator(withKnobs)
    .addDecorator(story => (
        <div style={{ margin: '5%' }}>
            <MockCurrentProject />
            {story()}
        </div>
    ))
    .add('APISettings', () => (
        <APISettings isRequesting={boolean('isRequesting', false)} {...props} />
    ));
