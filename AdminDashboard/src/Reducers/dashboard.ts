import {
    DASHBOARD_LOAD_REQUEST,
    DASHBOARD_LOAD_SUCCESS,
    DASHBOARD_LOAD_RESET,
    DASHBOARD_LOAD_FAILED,
} from '../constants/dashboard';

import Action from 'CommonUI/src/types/action';

const initialState: $TSFixMe = {
    requesting: false,
    error: null,
    success: false,
};

export default (state: $TSFixMe = initialState, action: Action): void => {
    switch (action.type) {
        case DASHBOARD_LOAD_REQUEST:
            return Object.assign({}, state, {
                requesting: true,
                error: null,
                success: false,
            });

        case DASHBOARD_LOAD_SUCCESS:
            return Object.assign({}, state, {
                requesting: false,
                error: null,
                success: true,
            });

        case DASHBOARD_LOAD_RESET:
            return Object.assign({}, state, {
                requesting: false,
                error: null,
                success: false,
            });

        case DASHBOARD_LOAD_FAILED:
            return Object.assign({}, state, {
                requesting: false,
                error: action.payload,
                success: false,
            });

        default:
            return state;
    }
};
