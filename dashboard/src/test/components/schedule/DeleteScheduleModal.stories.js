import React from 'react';
import { storiesOf, action } from '@storybook/react';
import { DeleteScheduleModal } from '../../../components/schedule/DeleteScheduleModal'

let props = {
    confirmThisDialog: action('submit'),
    closeThisDialog:action('submit'),
    isRequesting:false
}

let props_isRequesting = {
    confirmThisDialog: action('submit'),
    closeThisDialog:action('submit'),
    isRequesting:true
}

storiesOf('Schedule', module)
    .addDecorator(story => (
        <div style={{ margin: '5%' }} >
            {story()}</div>
    ))
    .add('Delete Schedule Modal', () =>
        <DeleteScheduleModal  {...props} />
    )
    .add('Delete Schedule Modal Requesting', () =>
        <DeleteScheduleModal {...props_isRequesting} />
    )
    

