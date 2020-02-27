import React from 'react';
import { storiesOf, action } from '@storybook/react';
import { withKnobs, boolean } from '@storybook/addon-knobs';
import { ProjectForm } from '../../../components/project/ProjectForm';
import { reduxForm } from 'redux-form';
import { Validate } from '../../../config';

function validate(values) {
    const errors = {};

    if (!Validate.text(values.projectName)) {
        errors.name = 'Project Name is required!';
    }

    if (!Validate.text(values.planId)) {
        errors.name = 'Stripe PlanID is required!';
    }

    return errors;
}

localStorage.setItem('id', '5b1c0c29cb06cc23b132db07');

const props = {
    array: {},
    anyTouched: false,
    asyncValidating: false,
    dirty: false,
    form: 'ProjectForm',
    initialized: false,
    invalid: false,
    pristine: true,
    submitFailed: false,
    submitSucceeded: false,
    valid: true,
    match: {
        path: '/project/:projectId/monitoring',
        url: '/project/5b1f39482a62c8611d23c953/monitoring',
        isExact: true,
        params: {
            projectId: '5b1f39482a62c8611d23c953',
        },
    },
    location: {
        pathname: '/project/5b1f39482a62c8611d23c953/monitoring',
        search: '',
        hash: '',
        key: '6f58m4',
    },
    history: {
        length: 30,
        action: 'PUSH',
        location: {
            pathname: '/project/5b1f39482a62c8611d23c953/monitoring',
            search: '',
            hash: '',
            key: '6f58m4',
        },
    },
    visible: true,
    errorStack: null,
    projects: {
        projects: {
            requesting: false,
            error: null,
            success: true,
            projects: [
                {
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
                    _id: '5b1f39482a62c8611d23c953',
                    name: 'Test 1',
                    apiKey: '403e2e10-75d9-11e8-9272-bf0bb40d80f7',
                    stripePlanId: 'plan_CpIUcLDhD1HKKA',
                    stripeSubscriptionId: 'sub_D276mFZNBg3iMK',
                    stripeMeteredSubscriptionId: 'sub_D276LWAbjABjIZ',
                    __v: 0,
                },
                {
                    users: [
                        {
                            userId: '5b1c0c29cb06cc23b132db07',
                            role: 'Administrator',
                            _id: '5b209dcff2fcff4072f64d91',
                        },
                    ],
                    createdAt: '2018-06-13T04:30:07.519Z',
                    _id: '5b209dcff2fcff4072f64d90',
                    name: 'hello',
                    apiKey: '738050a0-6ec2-11e8-a360-810647aa7e44',
                    stripePlanId: 'plan_CpIatF9qAmeZLP',
                    stripeSubscriptionId: 'sub_D5t5in5vqyxYm3',
                    stripeMeteredSubscriptionId: 'sub_D2VdfvSlUBRgJy',
                    __v: 0,
                },
            ],
        },
        currentProject: {
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
            _id: '5b1f39482a62c8611d23c953',
            name: 'Test 1',
            apiKey: '403e2e10-75d9-11e8-9272-bf0bb40d80f7',
            stripePlanId: 'plan_CpIUcLDhD1HKKA',
            stripeSubscriptionId: 'sub_D276mFZNBg3iMK',
            stripeMeteredSubscriptionId: 'sub_D276LWAbjABjIZ',
            __v: 0,
        },
        newProject: {
            requesting: false,
            error: null,
            success: false,
            project: {},
        },
        projectSwitcherVisible: false,
        resetToken: {
            success: false,
            requesting: false,
            error: null,
        },
        renameProject: {
            success: false,
            requesting: false,
            error: null,
        },
        changePlan: {
            success: false,
            requesting: false,
            error: null,
        },
        deleteProject: {
            success: false,
            requesting: false,
            error: null,
        },
        exitProject: {
            success: false,
            requesting: false,
            error: null,
        },
        showForm: true,
        showDeleteModal: false,
    },
    pure: true,
    handleSubmit: action('handleSubmit'),
    submitForm: action('submitForm'),
    hideForm: action('hideForm'),
};

const ProjectFormDecorated = new reduxForm({
    form: 'ProjectForm',
    validate,
})(ProjectForm);

storiesOf('Project', module)
    .addDecorator(withKnobs)
    .addDecorator(story => <div style={{ margin: '5%' }}>{story()}</div>)
    .add('ProjectForm', () => (
        <ProjectFormDecorated
            submitting={boolean('submitting', false)}
            {...props}
        />
    ));
