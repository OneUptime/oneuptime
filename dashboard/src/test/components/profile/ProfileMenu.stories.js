import React from 'react';
import { storiesOf } from '@storybook/react';
import {ProfileMenu} from '../../../components/profile/ProfileMenu'
import { withKnobs, boolean } from '@storybook/addon-knobs';
import { action } from '@storybook/addon-actions';


storiesOf('Profile', module)
.addDecorator(withKnobs)
    .addDecorator(story => (
        <div style={{ margin: '20%' }} >
            {story()}</div>
    ))
    .add('ProfileMenu', () =>
        <ProfileMenu hideProfileMenu={action('hideProfileMenu')} visible={boolean('visible', true)}  />
    )
