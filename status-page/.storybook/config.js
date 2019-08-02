import React from 'react';
import { configure, addDecorator } from '@storybook/react';
import Container from './Container';

addDecorator(story => <Container story={story} />);

configure(
  () => {
    const req = require.context('../src', true, /.stories.js$/);
    req.keys().forEach((filename) => req(filename));
  },
  module
);
