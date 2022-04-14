import { createStore, applyMiddleware, compose } from 'redux';
import { createLogger } from 'redux-logger';

import { routerMiddleware } from 'react-router-redux';
import thunk from 'redux-thunk';

import { createBrowserHistory, createMemoryHistory } from 'history';
// import createHistory from 'history/createBrowserHistory';
import rootReducer from './reducers';

// A nice helper to tell us if we're on the server
export const isApiServer: $TSFixMe = !(
    typeof window !== 'undefined' &&
    window.document &&
    window.document.createElement
);
// export const history: $TSFixMe = createHistory();
const url: string = '/';
export const history: $TSFixMe = isApiServer
    ? createMemoryHistory({ initialEntries: [url] })
    : createBrowserHistory();

const initialState: $TSFixMe = {};
const enhancers: $TSFixMe = [];
const logger: $TSFixMe = createLogger();
const middleware: $TSFixMe = [thunk, routerMiddleware(history)];

if (process.env['NODE_ENV'] === 'development') {
    let devToolsExtension: $TSFixMe;
    if (!isApiServer) {
        devToolsExtension = window.devToolsExtension;
    }
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
