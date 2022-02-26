import React from 'react';
import { Provider } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { render } from 'react-dom';
import store, { history } from './store';
import App from './App';
import './index.css';
import ErrorBoundary from './components/basic/ErrorBoundary';

const target = document.getElementById('root');

render(
    // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
    <Provider store={store} history={history}>
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    </Provider>,
    target
);
