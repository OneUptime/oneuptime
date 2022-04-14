import { createStore, applyMiddleware, compose } from 'redux';
import { createLogger } from 'redux-logger';

import { routerMiddleware } from 'react-router-redux';
import thunk from 'redux-thunk';

import { createBrowserHistory, createMemoryHistory } from 'history';
// import createHistory from 'history/createBrowserHistory';
import rootReducer from './reducers';

// A nice helper to tell us if we're on the server
export const isApiServer = !(
    typeof window !== 'undefined' &&
    window.document &&
    window.document.createElement
);
// export const history = createHistory();
const url: string = '/';
export const history = isApiServer
    ? createMemoryHistory({ initialEntries: [url] })
    : createBrowserHistory();

const initialState: $TSFixMe = {};
const enhancers = [];
const logger = createLogger();
const middleware = [thunk, routerMiddleware(history)];

if (process.env['NODE_ENV'] === 'development') {
    let devToolsExtension;
    if (!isApiServer) {
        devToolsExtension = window.devToolsExtension;
    }
    middleware.push(logger);

    if (typeof devToolsExtension === 'function') {
        enhancers.push(devToolsExtension());
    }
}

const composedEnhancers = compose(applyMiddleware(...middleware), ...enhancers);

const store = createStore(rootReducer, initialState, composedEnhancers);

export type RootState = ReturnType<typeof store.getState>;

export default store;
