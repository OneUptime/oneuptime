import { combineReducers } from 'redux';
import Action from 'CommonUI/src/Types/Action';
import { routerReducer } from 'react-router-redux';
import Login from './Login';
import Register from './Register';
import { RootState } from '../store';
import Modal from 'CommonUI/src/Reducers/Modal';
import ResetPassword from './ResetPassword';
import ChangePassword from './ChangePassword';
import ResendToken from './ResendVerifyEmail';


export default (state: RootState, action: Action): void => {
    if (action.type === 'CLEAR_STORE') {
        state = undefined;
    }
    return combineReducers({
        routing: routerReducer,
        Modal,
        new Login().getReducer(),
        new Register().getReducer(),
        new ResetPassword().getReducer(),
        new ChangePassword().getReducer(),
        new ResendToken().getReducer,
    })(state, action)
};
