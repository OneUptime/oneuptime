import { createStore, applyMiddleware, compose, Store } from 'redux';
import history from 'CommonUI/Src/Utils/History';
import { routerMiddleware } from 'react-router-redux';
import thunk from 'redux-thunk';
import RootReducers from './Reducers/Index';

const store: Store = createStore(
    RootReducers,
    {},
    compose(
        applyMiddleware(thunk, routerMiddleware(history))
    )
);

export type RootState = ReturnType<typeof store.getState>;

export default store;
