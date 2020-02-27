import React from 'react';
import { storiesOf, action } from '@storybook/react';
import { ProjectSwitcher } from '../../../components/project/ProjectSwitcher';
import { withKnobs, boolean } from '@storybook/addon-knobs';

const props = {
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
        key: 'nroft8',
    },
    history: {
        length: 28,
        action: 'PUSH',
        location: {
            pathname: '/project/5b1f39482a62c8611d23c953/monitoring',
            search: '',
            hash: '',
            key: 'nroft8',
        },
    },
    project: {
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
        showForm: false,
        showDeleteModal: false,
    },
    showForm: action('showForm'),
    hideProjectSwitcher: action('hideProjectSwitcher'),
    switchProject: action('switchProject'),
    dispatch: action('dispatch'),
};

storiesOf('Project', module)
    .addDecorator(withKnobs)
    .addDecorator(story => <div style={{ margin: '30%' }}>{story()}</div>)
    .add('ProjectSwitcher', () => (
        <ProjectSwitcher visible={boolean('visible', true)} {...props} />
    ));
