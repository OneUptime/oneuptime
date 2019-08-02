import React from 'react';
import { storiesOf } from '@storybook/react';
import TimezoneSelector from '../../../components/basic/TimezoneSelector'

const props_requesting = {
    meta: {
        touched: false,
        error: null
    },
    input: {}
};

storiesOf('Basic', module)
    .addDecorator(story => (
        <div id='login' className='register-page' style={{ overflow: 'auto' }} >
            <div style={{ margin: '20%' }} >
                {story()}</div>
        </div>
    ))
    .add('TimezoneSelector', () =>
        <TimezoneSelector {...props_requesting} />
    )

