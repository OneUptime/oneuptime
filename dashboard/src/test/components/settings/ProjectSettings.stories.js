import React from 'react';
import { storiesOf, action } from '@storybook/react';
import { withKnobs, boolean } from '@storybook/addon-knobs';
import { ProjectSettings } from '../../../components/settings/ProjectSettings'
import ProjectSettingsDafault from '../../../components/settings/ProjectSettings'
import { Provider } from 'react-redux';
import { state, mockStore } from '../../redux_mock'
import { Validate } from '../../../config';
import { reduxForm, reset } from 'redux-form';


const formName = 'ProjectSettings'+Math.floor((Math.random() * 10) + 1);
function validate(value) {

    const errors = {};

    if (!Validate.text(value.project_name)) {
        errors.name = 'Project name is required.'
    }

    return errors;
}

const onSubmitSuccess = (result, dispatch) => dispatch(reset(formName))


const ProjectSettingsForm = new reduxForm({
    form: formName,
    enableReinitialize:true,
    validate,
    onSubmitSuccess
})(ProjectSettings);

localStorage.setItem('id', '5b1c0c29cb06cc23b132db07')

const store = mockStore(state)

const props = {
    'array': {},
  'anyTouched': false,
  'asyncValidating': false,
  'dirty': false,
  'form': 'ProjectSettings8',
  'initialized': true,
  'initialValues': {
    'project_name': 'Test'
  },
  'invalid': false,
  'pristine': true,
  'submitting': false,
  'submitFailed': false,
  'submitSucceeded': false,
  'valid': true,
  'projectId': '5b5b3cd6759d8814a7162676',
  'pure': true,
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
    handleSubmit:() => {
        const openModal = action('handleSubmit');
        openModal('handleSubmit');
    },
    renameProject: () => {
        const renameProject = action('renameProject');
        renameProject('renameProject');
    },
    exitProject: () => {
        const exitProject = action('exitProject');
        exitProject('exitProject');
    },
    switchProject:() => {
        const switchProject = action('switchProject');
        switchProject('switchProject');
    },
    dispatch:() => {
        const dispatch = action('dispatch');
        dispatch('dispatch');
    }
}


storiesOf('Settings', module)
    .addDecorator(story => <Provider store={store}>{story()}</Provider>)
    .addDecorator(withKnobs)
    .add('ProjectSettings', () =>
        <ProjectSettingsForm isRequesting={boolean('isRequesting', false)}  {...props} />
    )
    .add('ProjectSettings Requesting', () =>
        <ProjectSettingsForm isRequesting={boolean('isRequesting', true)}  {...props} />
    )

    .add('ProjectSettings Default', () =>
        <ProjectSettingsDafault isRequesting={boolean('isRequesting', true)}  {...props} />
    )