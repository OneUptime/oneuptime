import React from 'react';
import { storiesOf, action } from '@storybook/react';
import { Modals } from '../../containers/BackboneModals'

const test = ()=><span>Hello in Modal Test</span>
test.displayName = 'test'

storiesOf('Containers', module)
    .addDecorator(story => (
        <div style={{ margin: '20%' }} >
            {story()}</div>
    ))
    .add('BackboneModals', () =>
        < Modals closeModal={action('closeModal')}
            modals={
                [
                    {
                        content: test
                    }
                ]
            }
        />
    )
