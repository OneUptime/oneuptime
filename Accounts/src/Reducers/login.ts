import {
    LOGIN_REQUEST,
    LOGIN_SUCCESS,
    LOGIN_FAILED,
    RESET_LOGIN,
    SAVE_STATUS_PAGE,
    CHANGE_LOGIN,
    AUTH_VERIFICATION_FAILED,
    AUTH_VERIFICATION_REQUEST,
    AUTH_VERIFICATION_SUCCESS,
    RESET_AUTH_VERIFICATION,
    BACKUP_CODE_VERIFICATION_FAILED,
    BACKUP_CODE_VERIFICATION_REQUEST,
    BACKUP_CODE_VERIFICATION_SUCCESS,
    RESET_BACKUP_CODE_VERIFICATION,
    MASTER_ADMIN_EXISTS_REQUEST,
    MASTER_ADMIN_EXISTS_FAILED,
    MASTER_ADMIN_EXISTS_SUCCESS,
    RESET_MASTER_ADMIN_EXISTS,
    LOGIN_STATE,
} from '../constants/login';

/*
 * The auth reducer. The starting state sets authentication
 * Based on a token being in local storage. In a real app,
 * We would also want a util to check if the token is expired.
 */

import Action from 'CommonUI/src/types/action';

const initialState: $TSFixMe = {
    requesting: false,
    user: {},
    error: null,
    success: false,
    statusPageLogin: false,
    statusPageURL: null,
    authToken: {
        requesting: false,
        error: null,
        success: false,
    },
    backupCode: {
        requesting: false,
        error: null,
        success: false,
    },
    masterAdmin: {
        exists: null,
        requesting: false,
        error: null,
        success: false,
    },
    loginMethod: 'standard',
};

export default function register(
    state: $TSFixMe = initialState,
    action: Action
): void {
    switch (action.type) {
        case CHANGE_LOGIN:
            return Object.assign({}, state, {
                loginMethod: action.payload,
            });
        case LOGIN_REQUEST:
            return Object.assign({}, state, {
                requesting: true,
                error: null,
            });
        case LOGIN_SUCCESS:
            return Object.assign({}, state, {
                requesting: false,
                success: true,
                error: null,
                user: action.payload,
            });
        case LOGIN_FAILED:
            return Object.assign({}, state, {
                requesting: false,
                success: false,
                error: action.payload,
            });
        case LOGIN_STATE:
            return Object.assign({}, state, {
                requesting: false,
                success: false,
                error: state.error,
                user: action.payload,
            });
        case RESET_LOGIN:
            return Object.assign({}, state, initialState);

        case MASTER_ADMIN_EXISTS_REQUEST:
            return Object.assign({}, state, {
                masterAdmin: {
                    ...state.masterAdmin,
                    requesting: true,
                    error: null,
                },
            });

        case MASTER_ADMIN_EXISTS_SUCCESS:
            return Object.assign({}, state, {
                masterAdmin: {
                    requesting: false,
                    success: true,
                    error: null,
                    exists: action.payload.result,
                },
            });

        case MASTER_ADMIN_EXISTS_FAILED:
            return Object.assign({}, state, {
                masterAdmin: {
                    ...state.masterAdmin,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case RESET_MASTER_ADMIN_EXISTS:
            return Object.assign({}, state, {
                masterAdmin: initialState.masterAdmin,
            });

        case AUTH_VERIFICATION_REQUEST:
            return Object.assign({}, state, {
                ...initialState,
                authToken: {
                    ...initialState.authToken,
                    requesting: true,
                    error: null,
                    success: true,
                },
                user: { ...state.user },
            });
        case AUTH_VERIFICATION_SUCCESS:
            return Object.assign({}, state, {
                ...initialState,
                authToken: {
                    ...initialState.authToken,
                    requesting: false,
                    error: null,
                    success: true,
                },
            });
        case AUTH_VERIFICATION_FAILED:
            return Object.assign({}, state, {
                ...initialState,
                authToken: {
                    ...initialState.authToken,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
                user: { ...state.user },
            });

        case RESET_AUTH_VERIFICATION:
            return Object.assign({}, state, initialState);

        // Use back up code to login a user

        case BACKUP_CODE_VERIFICATION_REQUEST:
            return Object.assign({}, state, {
                ...initialState,
                backupCode: {
                    ...initialState.backupCode,
                    requesting: true,
                    error: null,
                    success: true,
                },
                user: { ...state.user },
            });
        case BACKUP_CODE_VERIFICATION_SUCCESS:
            return Object.assign({}, state, {
                ...initialState,
                backupCode: {
                    ...initialState.backupCode,
                    requesting: false,
                    error: null,
                    success: true,
                },
            });
        case BACKUP_CODE_VERIFICATION_FAILED:
            return Object.assign({}, state, {
                ...initialState,
                backupCode: {
                    ...initialState.backupCode,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
                user: { ...state.user },
            });

        case RESET_BACKUP_CODE_VERIFICATION:
            return Object.assign({}, state, initialState);

        case SAVE_STATUS_PAGE:
            return Object.assign({}, state, {
                statusPageLogin: action.payload.isStatusPageLogin,
                statusPageURL: action.payload.statusPageURL,
            });

        default:
            return state;
    }
}
