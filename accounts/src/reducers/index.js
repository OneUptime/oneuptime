import { combineReducers } from 'redux';
import { routerReducer } from 'react-router-redux';
import login from './login';
import register from './register';
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
    resendToken
});

export default (state, action) => {
    if(action.type === 'CLEAR_STORE'){
        state = undefined;
    }
    return appReducer(state, action);
}
