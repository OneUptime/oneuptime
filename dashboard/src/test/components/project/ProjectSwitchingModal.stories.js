import React from 'react';
import { storiesOf } from '@storybook/react';
import { SwitchingModal } from '../../../components/project/ProjectSwitchingModal'

storiesOf('Project', module)
    .addDecorator(story => (
        <div style={{ margin: '20%' }} >
            {story()}</div>
    ))
    .add('ProjectSwitchingModal', () =>
        <SwitchingModal />
    )
