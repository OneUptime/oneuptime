import React from 'react';
import { storiesOf } from '@storybook/react';
import CompanySizeSelector from '../../../components/basic/CompanySizeSelector';

const props_requesting = {
    meta: {
        touched: false,
        error: null,
    },
    input: {},
};

storiesOf('Basic', module)
    .addDecorator(story => (
        <div id="login" className="register-page" style={{ overflow: 'auto' }}>
            <div style={{ margin: '20%' }}>{story()}</div>
        </div>
    ))
    .add('CompanySizeSelector', () => (
        <CompanySizeSelector {...props_requesting} />
    ));
