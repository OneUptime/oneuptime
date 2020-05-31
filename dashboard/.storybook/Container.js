import React from 'react';
import { ThroughProvider } from 'react-through';

import axiosMock from '../src/test/axios_mock'
import {
  API_URL
} from '../src/config'

axiosMock.onPost(`${API_URL}/*`).reply(200, null, {});
axiosMock.onGet(`${API_URL}/*`).reply(200, null, {});

import { storiesOf } from '@storybook/react';
import store from '../src/store'
import Login from '../src/pages/Login'
import { Provider } from 'react-redux';
import { Router } from 'react-router';
import { history } from '../src/store';
import ErrorBoundary from '../src/components/basic/ErrorBoundary';

Date.now = (() => 1487076708000)

localStorage.setItem('access_token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjViMWMwYzI5Y2IwNmNjMjNiMTMyZGIwNyIsIm5hbWUiOiJEYW5zdGFuIE9ueWFuZ28iLCJlbWFpbCI6ImRhbnN0YW4ub3RpZW5vQGdtYWlsLmNvbSIsImlhdCI6MTUzMDA0MzExOCwiZXhwIjoxNTM4NjgzMTE4fQ.pFQe22E51cTEURtecghKp64zPMR0SsUi8tdsf5ol1iQ')

export default class Container extends React.Component {
  render() {
    const { story } = this.props;

    return (
      <Provider store={store}>
          <ErrorBoundary>
            <Router history={history}>
              {story()}
            </Router>
          </ErrorBoundary>
      </Provider>
    );
  }
}
