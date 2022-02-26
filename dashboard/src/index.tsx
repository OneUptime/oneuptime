import React from 'react';
import { Provider } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Frontload } from 'react-frontload';
import ReactGA from 'react-ga';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { ThroughProvider } from 'react-through';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { render } from 'react-dom';
import * as serviceWorker from './serviceWorker';
import store, { history, isServer } from './store';
import App from './App';
import './index.css';
import ErrorBoundary from './components/basic/ErrorBoundary';

if (!isServer) {
    ReactGA.initialize('UA-115085157-1');
}

const target = document.getElementById('root');

render(
    <ThroughProvider>
        // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
        <Provider store={store} history={history}>
            <Frontload noServerRender={true}>
                <ErrorBoundary>
                    <App />
                </ErrorBoundary>
            </Frontload>
        </Provider>
    </ThroughProvider>,
    target
);

// this will enable the app to work offline and load faster
// @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 0.
serviceWorker.register();
