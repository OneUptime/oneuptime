import React from 'react';
import { storiesOf } from '@storybook/react';
import { reduxForm } from 'redux-form';
import UserInputs from '../../../components/schedule/UserInputs';

const UserInputsDecorated = new reduxForm({
    form: 'AddUsersForm',
    enableReinitialize: true,
})(UserInputs);

const props_with_User_admin = {
    project: {
        id: '5b1f39482a62c8611d23c953',
        users: [
            {
                userId: '5b1c0c29cb06cc23b132db07',
                role: 'Administrator',
                _id: '5b1f39482a62c8611d23c954',
            },
            {
                userId: '5b1d20232352d77c91b2dae1',
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
    },
    users: [
        {
            userId: '5b1c0c29cb06cc23b132db07',
            role: 'Administrator',
            _id: '5b1f39482a62c8611d23c954',
            email: 'danstan.otieno@gmail.com',
            lastActive: '2018-06-23T13:57:47.919Z',
            name: 'Danstan Onyango',
        },
        {
            userId: '5b1d20232352d77c91b2dae1',
            role: 'Member',
            _id: '5b2c77fa728c4b2bc286eca4',
            email: 'otis.eng@gmail.com',
            lastActive: '2018-06-23T13:57:47.919Z',
            name: 'Hacker Bayer',
        },
    ],
};

const props_with_user_not_admin = {
    project: {
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
    },
    users: [
        {
            userId: '5b1c0c29cb06cc23b132db07',
            role: 'Administrator',
            _id: '5b1f39482a62c8611d23c954',
            email: 'danstan.otieno@gmail.com',
            lastActive: '2018-06-23T13:57:47.919Z',
            name: 'Danstan Onyango',
        },
        {
            userId: '5b1d20232352d77c91b2dae1',
            role: 'Member',
            _id: '5b2c77fa728c4b2bc286eca4',
            email: 'otis.eng@gmail.com',
            lastActive: '2018-06-23T13:57:47.919Z',
            name: 'Hacker Bayer',
        },
    ],
};
storiesOf('Schedule', module)
    .addDecorator(story => <div style={{ margin: '5%' }}>{story()}</div>)
    .add('UserInput User Is Admin', () => (
        <UserInputsDecorated {...props_with_User_admin} />
    ))
    .add('UserInput User Not Admin', () => (
        <UserInputsDecorated {...props_with_user_not_admin} />
    ));
