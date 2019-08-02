import React from 'react';
import { storiesOf } from '@storybook/react';
import {RenderLinks} from '../../../components/basic/RenderLinks'
import {reduxForm} from 'redux-form'

localStorage.setItem('id', '5b1c0c29cb06cc23b132db07')

const props = {
    'meta': {
        submitFailed:null,
        error:null
    },
    'fields':[]
}

const props_with_input = 
{
    'meta': {
        submitFailed:null,
        error:null
    },
    'fields':[{name: '', url: ''}]
} 

let RenderLinksForm = reduxForm({
    form: 'Links', // a unique identifier for this form
    enableReinitialize: true
})(RenderLinks);

storiesOf('Basic', module)
    .addDecorator(story => (
        <div style={{ margin: '20%' }} >
                {story()}</div>
    ))
    .add('RenderLinks', () =>
        <RenderLinks {...props} />
    )
    .add('RenderLinks With Input', () =>
        <RenderLinksForm {...props_with_input} />
    )