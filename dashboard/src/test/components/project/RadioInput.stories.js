import React from 'react';
import { storiesOf } from '@storybook/react';
import { RadioInput } from '../../../components/project/RadioInput'
import {reduxForm} from 'redux-form'



localStorage.setItem('id', '5b1c0c29cb06cc23b132db07')

let props = {
    id: 'ID here',
    details: 'Details here',
    value: 'Value here',
}

let RadioInput_Decorated = new reduxForm({
    form: 'RadioInput',
})(RadioInput);


storiesOf('Project', module)
    .addDecorator(story => (
        <div style={{ margin: '20%' }} >
            {story()}</div>
    ))
    .add('RadioInput', () =>
        <RadioInput_Decorated  {...props} />
    )
