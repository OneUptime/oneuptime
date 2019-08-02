import React from 'react';
import { storiesOf, action } from '@storybook/react';
import {reduxForm} from 'redux-form'
import { Validate } from '../../../config';
import { RenameScheduleBox } from '../../../components/schedule/RenameScheduleBox'
import {MockCurrentProject} from '../../ReduxStore_Mock'

function validate(value) {

    const errors = {};

    if (!Validate.text(value.schedule_name)) {
        errors.name = 'Schedule name is required.'
    }

    return errors;
}

let props = {
    handleSubmit: action('handleSubmit'),
    renameSchedule:action('renameSchedule'),
    isRequesting:false,
    history:{},
    initialValues:{schedule_name: 'Test'}
}

let onSubmitSuccess = action('onSubmitSuccess')

let RenameScheduleForm = new reduxForm({
    form: 'RenameSchedule' + Math.floor((Math.random() * 10) + 1),
    validate,
    onSubmitSuccess,
    enableReinitialize: true
})(RenameScheduleBox);


storiesOf('Schedule', module)
    .addDecorator(story => (
        <div style={{ margin: '5%' }} >
        <MockCurrentProject/>
            {story()}</div>
    ))
    .add('Rename Schedule Box', () =>
        <RenameScheduleForm  {...props} />
    )

