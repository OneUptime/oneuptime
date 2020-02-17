import React from 'react';
import { storiesOf, action } from '@storybook/react';
import DeleteMonitor from '../../../components/modals/DeleteMonitor'

const props = {
    confirmThisDialog:action('confirmThisDialog'),
    closeThisDialog:action('closeThisDialog')
}


storiesOf('Modals', module)
    .addDecorator(story => (
        <div style={{ margin: '20%' }} >
            {story()}</div>
    ))
    .add('DeleteMonitor', () =>
        <DeleteMonitor  {...props} />
    )
