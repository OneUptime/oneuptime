import {
    LOGIN_REQUIRED,
    LOGIN_REQUEST,
    LOGIN_SUCCESS,
    LOGIN_FAILED,
    RESET_LOGIN,
} from '../constants/login';

import Action from 'CommonUI/src/types/action';

const INITIAL_STATE: $TSFixMe = {
    loginRequired: false,
    success: false,
    requesting: false,
    error: false,
};

export default (state: $TSFixMe = INITIAL_STATE, action: Action): void => {
    switch (action.type) {
        case LOGIN_REQUIRED:
            return Object.assign({}, state, {
                loginRequired: true,
            });

        case LOGIN_REQUEST:
            return Object.assign({}, state, {
                requesting: true,
                error: null,
            });

        case LOGIN_SUCCESS:
            return Object.assign({}, state, {
                loginRequired: false,
                requesting: false,
                success: true,
                error: null,
            });

        case LOGIN_FAILED:
            return Object.assign({}, state, {
                loginRequired: true,
                requesting: false,
                success: false,
                error: action.payload,
            });

        case RESET_LOGIN:
            return Object.assign({}, state, INITIAL_STATE);

        default:
            return state;
    }
};
