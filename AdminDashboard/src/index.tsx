import React from 'react';
import { Provider } from 'react-redux';

import { render } from 'react-dom';
import store, { history } from './store';
import App from './App';
import './index.css';
import ErrorBoundary from './components/basic/ErrorBoundary';

const target: $TSFixMe = document.getElementById('root');

render(

    <Provider store={store} history={history}>
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    </Provider>,
    target
);
