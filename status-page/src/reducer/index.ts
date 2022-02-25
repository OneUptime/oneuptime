import { combineReducers } from 'redux';
import { reducer as form } from 'redux-form';
import login from './login';
import status from './status';
import probe from './probe';
import subscribe from './subscribe';

const appReducer = combineReducers({ form, login, status, probe, subscribe });

export default (state, action) => {
    if (action.type === 'CLEAR_STORE') {
        state = undefined;
    }

    return appReducer(state, action);
};
