import { createStore, applyMiddleware, compose } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { createLogger } from 'redux-logger';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { routerMiddleware } from 'react-router-redux';
import thunk from 'redux-thunk';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'hist... Remove this comment to see the full error message
import { createBrowserHistory } from 'history';
import rootReducer from '../reducer/index';

export const history = createBrowserHistory();

export const removeQuery = () => {
    const location = Object.assign({}, history.location);
    delete location.search;
    history.push(location);
};

const initialState = {};
const enhancers = [];
const logger = createLogger();
const middleware = [thunk, routerMiddleware(history)];

if (process.env.NODE_ENV === 'development') {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'devToolsExtension' does not exist on typ... Remove this comment to see the full error message
    const devToolsExtension = window.devToolsExtension;
    middleware.push(logger);

    if (typeof devToolsExtension === 'function') {
        enhancers.push(devToolsExtension());
    }
}

const composedEnhancers = compose(applyMiddleware(...middleware), ...enhancers);

export default createStore(rootReducer, initialState, composedEnhancers);
