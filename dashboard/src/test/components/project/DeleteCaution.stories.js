import React from 'react';
import { storiesOf,action } from '@storybook/react';
import { DeleteCaution } from '../../../components/project/DeleteCaution'
import { withKnobs, boolean } from '@storybook/addon-knobs';

let props  = {
    deleteProject:(details)=>{
        const deleteProject = action('deleteProject');
        deleteProject(details);
        return Promise.resolve(details)
    },
    hide: action('hide'),
}

storiesOf('Project', module)
.addDecorator(withKnobs)
    .addDecorator(story => (
        <div style={{ margin: '5%' }} >
            {story()}</div>
    ))
    .add('DeleteCaution', () =>
        <DeleteCaution requesting={boolean('requesting', false)}  {...props} />
    )
