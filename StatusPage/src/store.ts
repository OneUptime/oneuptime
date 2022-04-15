import { createStore, applyMiddleware, compose } from 'redux';

import { createLogger } from 'redux-logger';

import { routerMiddleware } from 'react-router-redux';
import thunk from 'redux-thunk';

import { createBrowserHistory } from 'history';
import rootReducer from './reducer/index';

export const history: $TSFixMe = createBrowserHistory();

export const removeQuery: Function = (): void => {
    const location: $TSFixMe = Object.assign({}, history.location);
    delete location.search;
    history.push(location);
};

const initialState: $TSFixMe = {};
const enhancers: $TSFixMe = [];
const logger: $TSFixMe = createLogger();
const middleware: $TSFixMe = [thunk, routerMiddleware(history)];

if (process.env.NODE_ENV === 'development') {
    const devToolsExtension: $TSFixMe = window.devToolsExtension;
    middleware.push(logger);

    if (typeof devToolsExtension === 'function') {
        enhancers.push(devToolsExtension());
    }
}

const composedEnhancers: $TSFixMe = compose(
    applyMiddleware(...middleware),
    ...enhancers
);

const store: $TSFixMe = createStore(
    rootReducer,
    initialState,
    composedEnhancers
);

export type RootState = ReturnType<typeof store.getState>;

export default store;
