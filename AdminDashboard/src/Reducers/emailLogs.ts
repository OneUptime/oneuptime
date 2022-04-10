import {
    FETCH_EMAILLOGS_REQUEST,
    FETCH_EMAILLOGS_SUCCESS,
    FETCH_EMAILLOGS_FAILURE,
    SEARCH_EMAILLOGS_REQUEST,
    SEARCH_EMAILLOGS_SUCCESS,
    SEARCH_EMAILLOGS_FAILURE,
    DELETE_ALL_EMAILLOGS_REQUEST,
    DELETE_ALL_EMAILLOGS_SUCCESS,
    DELETE_ALL_EMAILLOGS_FAILURE,
    FETCH_EMAILLOG_STATUS_FAILED,
    FETCH_EMAILLOG_STATUS_REQUEST,
    FETCH_EMAILLOG_STATUS_SUCCESS,
    FETCH_EMAILLOG_STATUS_RESET,
    CHANGE_EMAILLOG_STATUS_FAILED,
    CHANGE_EMAILLOG_STATUS_REQUEST,
    CHANGE_EMAILLOG_STATUS_RESET,
    CHANGE_EMAILLOG_STATUS_SUCCESS,
} from '../constants/emailLogs';

import Action from 'CommonUI/src/types/action';

const INITIAL_STATE = {
    emailLogs: {
        error: null,
        requesting: false,
        success: false,
        emailLogs: [],
        count: null,
        limit: null,
        skip: null,
        deleteRequest: false,
        deleted: false,
    },
    searchEmailLogs: {
        requesting: false,
        error: null,
        success: false,
    },
    emailLogStatus: {
        error: null,
        requesting: false,
        success: false,
        data: null,
    },
    changeEmailLogStatus: {
        error: null,
        requesting: false,
        success: false,
    },
};

export default function project(state = INITIAL_STATE, action: Action) {
    switch (action.type) {
        // Fetch emailLogs list
        case FETCH_EMAILLOGS_REQUEST:
            return Object.assign({}, state, {
                emailLogs: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case FETCH_EMAILLOGS_SUCCESS:
            return Object.assign({}, state, {
                emailLogs: {
                    requesting: false,
                    error: null,
                    success: true,
                    emailLogs: action.payload.data,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip,
                    deleteRequest: false,
                    deleted: false,
                },
            });

        case FETCH_EMAILLOGS_FAILURE:
            return Object.assign({}, state, {
                emailLogs: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        // Search EmailLog list.
        case SEARCH_EMAILLOGS_REQUEST:
            return Object.assign({}, state, {
                searchEmailLogs: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case SEARCH_EMAILLOGS_SUCCESS:
            return Object.assign({}, state, {
                emailLogs: {
                    requesting: false,
                    error: null,
                    success: true,
                    emailLogs: action.payload.data,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip,
                    deleteRequest: false,
                    deleted: true,
                },
                searchEmailLogs: {
                    requesting: false,
                    error: null,
                    success: true,
                },
            });

        case SEARCH_EMAILLOGS_FAILURE:
            return Object.assign({}, state, {
                searchEmailLogs: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        //Delete all Email logs
        case DELETE_ALL_EMAILLOGS_REQUEST:
            return {
                ...state,
                emailLogs: {
                    ...state.emailLogs,
                    error: null,
                    success: false,
                    deleteRequest: true,
                },
            };

        case DELETE_ALL_EMAILLOGS_SUCCESS:
            return Object.assign({}, state, {
                emailLogs: {
                    requesting: false,
                    error: null,
                    success: true,
                    deleteRequest: false,
                    deleted: true,
                    emailLogs: [],
                    count: null,
                    limit: null,
                    skip: null,
                },
            });

        case DELETE_ALL_EMAILLOGS_FAILURE:
            return {
                ...state,
                emailLogs: {
                    ...state.emailLogs,
                    error: action.payload,
                    success: false,
                    deleteRequest: false,
                },
            };
        case FETCH_EMAILLOG_STATUS_REQUEST:
            return Object.assign({}, state, {
                emailLogStatus: {
                    error: null,
                    requesting: true,
                    success: false,
                    data: null,
                },
            });

        case FETCH_EMAILLOG_STATUS_SUCCESS: {
            return Object.assign({}, state, {
                emailLogStatus: {
                    error: null,
                    requesting: false,
                    success: true,
                    data: {
                        ...action.payload,
                    },
                },
            });
        }

        case FETCH_EMAILLOG_STATUS_FAILED:
            return Object.assign({}, state, {
                emailLogStatus: {
                    ...state.emailLogStatus,
                    error: action.payload,
                    requesting: false,
                    success: false,
                },
            });

        case FETCH_EMAILLOG_STATUS_RESET:
            return Object.assign({}, state, {
                emailLogStatus: {
                    error: null,
                    requesting: false,
                    success: false,
                    data: null,
                },
            });
        case CHANGE_EMAILLOG_STATUS_REQUEST:
            return Object.assign({}, state, {
                changeEmailLogStatus: {
                    error: null,
                    requesting: true,
                    success: false,
                },
            });

        case CHANGE_EMAILLOG_STATUS_SUCCESS: {
            return Object.assign({}, state, {
                emailLogStatus: {
                    error: null,
                    requesting: false,
                    success: true,
                    data: {
                        ...action.payload,
                    },
                },
                changeEmailLogStatus: {
                    error: null,
                    requesting: false,
                    success: true,
                },
            });
        }

        case CHANGE_EMAILLOG_STATUS_FAILED:
            return Object.assign({}, state, {
                changeEmailLogStatus: {
                    error: action.payload,
                    requesting: false,
                    success: false,
                },
            });

        case CHANGE_EMAILLOG_STATUS_RESET:
            return Object.assign({}, state, {
                changeEmailLogStatus: {
                    error: null,
                    requesting: false,
                    success: false,
                },
            });

        default:
            return state;
    }
}
