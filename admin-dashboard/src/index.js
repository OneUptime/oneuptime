import React from 'react';
import { Provider } from 'react-redux';
import ErrorBoundary from './components/basic/ErrorBoundary';
import { render } from 'react-dom';
import store, { history, isServer } from './store';
import App from './App';
import './index.css';

const target = document.getElementById('root');

render(
    <Provider store={store} history={history}>
            <ErrorBoundary>
                <App />
            </ErrorBoundary>
    </Provider>,
    target
);
