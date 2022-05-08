import React from 'react';
import { Provider } from 'react-redux';
import ReactGA from 'react-ga';
import ErrorBoundary from './components/basic/ErrorBoundary';

import { render } from 'react-dom';
import store, { history, isApiServer } from './store';
import App from './App';
import './index.css';

if (!isApiServer) {
    ReactGA.initialize('UA-115085157-1');
}
const target: $TSFixMe = document.getElementById('root');

render(

    <Provider store={store} history={history}>
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    </Provider>,
    target
);

