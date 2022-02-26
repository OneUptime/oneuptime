import { createStore, applyMiddleware, compose } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { createLogger } from 'redux-logger';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { routerMiddleware } from 'react-router-redux';
import thunk from 'redux-thunk';
import { createBrowserHistory, createMemoryHistory } from 'history';
import rootReducer from './reducers';

// A nice helper to tell us if we're on the server
export const isServer = !(
    typeof window !== 'undefined' &&
    window.document &&
    window.document.createElement
);

const url = '/';
export const history = isServer
    ? createMemoryHistory({ initialEntries: [url] })
    : createBrowserHistory();
const initialState = {};
const enhancers = [];
const logger = createLogger();
const middleware = [thunk, routerMiddleware(history)];

if (process.env.NODE_ENV === 'development') {
    let devToolsExtension;
    if (!isServer) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'devToolsExtension' does not exist on typ... Remove this comment to see the full error message
        devToolsExtension = window.devToolsExtension;
    }
    middleware.push(logger);

    if (typeof devToolsExtension === 'function') {
        enhancers.push(devToolsExtension());
    }
}

const composedEnhancers = compose(applyMiddleware(...middleware), ...enhancers);

export default createStore(rootReducer, initialState, composedEnhancers);
