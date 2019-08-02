import React from 'react';
import { storiesOf } from '@storybook/react';
import TutorialBox from '../../../components/tutorial/TutorialBox';

storiesOf('Tutorial', module)
    .addDecorator(story => (
        <div style={{ margin: '5%' }} >
         {story()}
        </div>
    ))
    .add('Tutorials base component', () =>
        <TutorialBox />
    )
    
