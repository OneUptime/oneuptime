import { combineReducers } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { routerReducer } from 'react-router-redux';
import login from './login';
import register from './register';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reducer as formReducer } from 'redux-form';
import modal from './modal';
import resetPassword from './resetPassword';
import changePassword from './changePassword';
import resendToken from './resendToken';

const appReducer = combineReducers({
    routing: routerReducer,
    login,
    register,
    form: formReducer,
    modal,
    resetPassword,
    changePassword,
    resendToken,
});

export default (state: $TSFixMe, action: $TSFixMe) => {
    if (action.type === 'CLEAR_STORE') {
        state = undefined;
    }
    return appReducer(state, action);
};
