import React from 'react';
import { Provider } from 'react-redux';
import ErrorBoundary from './components/basic/ErrorBoundary';
import { render } from 'react-dom';
import store, { history } from './store';
import App from './App';
import './index.css';

const target = document.getElementById('root');

render(
    <Provider store={store} history={history}>
        <App />
    </Provider>,
    target
);
