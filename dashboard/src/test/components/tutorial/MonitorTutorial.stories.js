import React from 'react';
import { storiesOf } from '@storybook/react';
import MonitorTutorial from '../../../components/tutorial/MonitorTutorial';

storiesOf('Tutorial', module)
    .addDecorator(story => (
        <div style={{ margin: '5%' }} >
         {story()}
        </div>
    ))
    .add('Monitor tutorial component', () =>
        <MonitorTutorial />
    )
    
