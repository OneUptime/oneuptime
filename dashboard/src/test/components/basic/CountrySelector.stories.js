import React from 'react';
import { storiesOf } from '@storybook/react';
import CountrySelector from '../../../components/basic/CountrySelector'

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
    .add('CountrySelector', () =>
        <CountrySelector {...props_requesting} />
    )

