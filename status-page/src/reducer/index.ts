import { combineReducers } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reducer as form } from 'redux-form';
import login from './login';
import status from './status';
import probe from './probe';
import subscribe from './subscribe';

const appReducer = combineReducers({ form, login, status, probe, subscribe });

export default (state: $TSFixMe, action: $TSFixMe) => {
    if (action.type === 'CLEAR_STORE') {
        state = undefined;
    }

    return appReducer(state, action);
};
