import {
    LOGIN_REQUEST,
    LOGIN_SUCCESS,
    LOGIN_FAILED,
    RESET_LOGIN,
    SAVE_STATUS_PAGE,
    AUTH_VERIFICATION_FAILED,
    AUTH_VERIFICATION_REQUEST,
    AUTH_VERIFICATION_SUCCESS,
    RESET_AUTH_VERIFICATION,
    BACKUP_CODE_VERIFICATION_FAILED,
    BACKUP_CODE_VERIFICATION_REQUEST,
    BACKUP_CODE_VERIFICATION_SUCCESS,
    RESET_BACKUP_CODE_VERIFICATION,
} from '../constants/login';

// The auth reducer. The starting state sets authentication
// based on a token being in local storage. In a real app,
// we would also want a util to check if the token is expired.

const initialState = {
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
};

export default function register(state = initialState, action) {
    switch (action.type) {
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

        case RESET_LOGIN:
            return Object.assign({}, state, initialState);

        case AUTH_VERIFICATION_REQUEST:
            return Object.assign({}, state, {
                ...initialState,
                authToken: {
                    ...initialState.authToken,
                    requesting: true,
                    error: null,
                    success: true,
                },
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
            });

        case RESET_BACKUP_CODE_VERIFICATION:
            return Object.assign({}, state, initialState);

        case SAVE_STATUS_PAGE:
            return Object.assign({}, state, {
                statusPageLogin: action.payload.statusPageLogin,
                statusPageURL: action.payload.statusPageURL,
            });

        default:
            return state;
    }
}
