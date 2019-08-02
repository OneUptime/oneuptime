import React from 'react';
import { storiesOf } from '@storybook/react';
import Footer from '../../../components/Footer'

storiesOf('Footer', module)
    .add('Footer with Links', () =>
    <Footer link = {{ url: 'https://fyipe.com', name: 'Staus page link 1'} } />
    )
    .add('Footer with no Link', () =>
    <Footer link = {{ name: 'Staus page link 1'} } />
    )