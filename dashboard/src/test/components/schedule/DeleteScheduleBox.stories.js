import React from 'react';
import { storiesOf, action } from '@storybook/react';
import { DeleteScheduleBox } from '../../../components/schedule/DeleteBox';

localStorage.setItem('id', '5b1c0c29cb06cc23b132db07');

const props = {
    deleteSchedule: action('deleteSchedule'),
    openModal: action('openModal'),
    isRequesting: false,
    history: {},
};

const props_isRequesting = {
    deleteSchedule: action('deleteSchedule'),
    openModal: action('openModal'),
    isRequesting: true,
    history: {},
};

storiesOf('Schedule', module)
    .addDecorator(story => <div style={{ margin: '5%' }}>{story()}</div>)
    .add('Delete Schedule Box', () => <DeleteScheduleBox {...props} />)
    .add('Delete Schedule Box Requesting', () => (
        <DeleteScheduleBox {...props_isRequesting} />
    ));
