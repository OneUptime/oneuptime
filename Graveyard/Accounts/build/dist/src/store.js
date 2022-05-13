import { createStore, applyMiddleware, compose } from 'redux';
import history from 'CommonUI/Src/Utils/History';
import { routerMiddleware } from 'react-router-redux';
import thunk from 'redux-thunk';
import RootReducers from './Reducers/Index';
const store = createStore(RootReducers, {}, compose(applyMiddleware(thunk, routerMiddleware(history))));
export default store;
