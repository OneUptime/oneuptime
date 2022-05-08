import {
    PASSWORDRESET_REQUEST,
    PASSWORDRESET_SUCCESS,
    PASSWORDRESET_FAILED,
    RESET_PASSWORDRESET,
} from '../constants/resetPassword';

/*
 * The auth reducer. The starting state sets authentication
 * Based on a token being in local storage. In a real app,
 * We would also want a util to check if the token is expired.
 */

import Action from 'CommonUI/src/Types/Action';

const initialState: $TSFixMe = {
    requesting: false,
    error: null,
    success: false,
};

export default function register(
    state: $TSFixMe = initialState,
    action: Action
): void {
    switch (action.type) {
        case PASSWORDRESET_REQUEST:
            return Object.assign({}, state, {
                requesting: true,
                error: null,
            });
        case PASSWORDRESET_SUCCESS:
            return Object.assign({}, state, {
                requesting: false,
                success: true,
                error: null,
            });
        case PASSWORDRESET_FAILED:
            return Object.assign({}, state, {
                requesting: false,
                success: false,
                error: action.payload,
            });

        case RESET_PASSWORDRESET:
            return Object.assign({}, state, initialState);

        default:
            return state;
    }
}
