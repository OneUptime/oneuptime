import React from 'react';
import { storiesOf, action } from '@storybook/react';
import { withKnobs, boolean } from '@storybook/addon-knobs';
import { Plans } from '../../../components/settings/ChangePlan'
import { MockCurrentProject } from '../../ReduxStore_Mock'
import {reduxForm} from 'redux-form'

localStorage.setItem('id', '5b1c0c29cb06cc23b132db07')

let props = {
    currentProject: {
        '_id': '5b1f39482a62c8611d23c953',
        'users': [
            {
                'userId': '5b1c0c29cb06cc23b132db07',
                'role': 'Administrator',
                '_id': '5b1f39482a62c8611d23c954'
            },
            {
                'userId': '5b1d20232352d77c91b2dae1',
                'role': 'Administrator',
                '_id': '5b2c77fa728c4b2bc286eca4'
            }
        ],
        'createdAt': '2018-06-12T03:08:56.638Z',
        'name': 'Test 1',
        'apiKey': '403e2e10-75d9-11e8-9272-bf0bb40d80f7',
        'stripePlanId': 'plan_CpIUcLDhD1HKKA',
        'stripeSubscriptionId': 'sub_D276mFZNBg3iMK',
        'stripeMeteredSubscriptionId': 'sub_D276LWAbjABjIZ',
    },
    initialValues:{},
    handleSubmit: (details) => {
        const handleSubmit = action('handleSubmit');
        handleSubmit(details);
    },
    changePlan: (details) => {
        const changePlan = action('changePlan');
        changePlan(details);
    },
}


let props_with_default = Object.assign({},props)
props_with_default.initialValues = {planId:'plan_CpIZEEfT4YFSvF'}

function Validate(values) {

    const errors = {};

    if (!Validate.text(values.planId)) {
        errors.name = 'Stripe PlanID is required!'
    }

    return errors;
}


let ChangePlan = new reduxForm({
    form: 'ChangePlan',
    Validate
})(Plans);


storiesOf('Settings', module)
    .addDecorator(withKnobs)
    .addDecorator(story => (
        <div style={{ margin: '5%' }} >
            <MockCurrentProject />
            {story()}</div>
    ))
    .add('ChangePlan', () =>
        <ChangePlan isRequesting={boolean('isRequesting', false)}  {...props} />
    )
    .add('ChangePlan With Default', () =>
    <ChangePlan isRequesting={boolean('isRequesting', false)}  {...props_with_default} />
)