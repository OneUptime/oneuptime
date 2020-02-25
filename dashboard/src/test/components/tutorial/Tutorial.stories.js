import React from 'react';
import { storiesOf } from '@storybook/react';
import Tutorial from '../../../components/tutorial/Tutorial';

storiesOf('Tutorial', module)
    .addDecorator(story => (
        <div style={{ margin: '5%' }} >
            {story()}
        </div>
    ))
    .add('Tutorial component', () =>
        <Tutorial />
    )

