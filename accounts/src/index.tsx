import React from 'react';
import { Provider } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Frontload } from 'react-frontload';
import ReactGA from 'react-ga';
import ErrorBoundary from './components/basic/ErrorBoundary';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { render } from 'react-dom';
import store, { history, isServer } from './store';
import App from './App';
import './index.css';
import * as serviceWorker from './serviceWorker';

if (!isServer) {
    ReactGA.initialize('UA-115085157-1');
}
const target = document.getElementById('root');

render(
    // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
    <Provider store={store} history={history}>
        <Frontload noServerRender={true}>
            <ErrorBoundary>
                // @ts-expect-error ts-migrate(2739) FIXME: Type '{}' is missing the following properties from... Remove this comment to see the full error message
                <App />
            </ErrorBoundary>
        </Frontload>
    </Provider>,
    target
);

// this will enable the app to work offline and load faster
// @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 0.
serviceWorker.register();
