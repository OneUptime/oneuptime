import {
    FETCH_CALLLOGS_REQUEST,
    FETCH_CALLLOGS_SUCCESS,
    FETCH_CALLLOGS_FAILURE,
    SEARCH_CALLLOGS_REQUEST,
    SEARCH_CALLLOGS_SUCCESS,
    SEARCH_CALLLOGS_FAILURE,
    DELETE_ALL_CALLLOGS_REQUEST,
    DELETE_ALL_CALLLOGS_SUCCESS,
    DELETE_ALL_CALLLOGS_FAILURE,
    FETCH_CALLLOG_STATUS_FAILED,
    FETCH_CALLLOG_STATUS_REQUEST,
    FETCH_CALLLOG_STATUS_SUCCESS,
    FETCH_CALLLOG_STATUS_RESET,
    CHANGE_CALLLOG_STATUS_FAILED,
    CHANGE_CALLLOG_STATUS_REQUEST,
    CHANGE_CALLLOG_STATUS_RESET,
    CHANGE_CALLLOG_STATUS_SUCCESS,
} from '../constants/callLogs';

import Action from 'CommonUI/src/types/action';

const INITIAL_STATE: $TSFixMe = {
    callLogs: {
        error: null,
        requesting: false,
        success: false,
        callLogs: [],
        count: null,
        limit: null,
        skip: null,
        deleteRequest: false,
        deleted: false,
    },
    searchCallLogs: {
        requesting: false,
        error: null,
        success: false,
    },
    callLogStatus: {
        error: null,
        requesting: false,
        success: false,
        data: null,
    },
    changeCallLogStatus: {
        error: null,
        requesting: false,
        success: false,
    },
};

export default function project(state = INITIAL_STATE, action: Action): void {
    switch (action.type) {
        // Fetch callLogs list
        case FETCH_CALLLOGS_REQUEST:
            return Object.assign({}, state, {
                callLogs: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case FETCH_CALLLOGS_SUCCESS:
            return Object.assign({}, state, {
                callLogs: {
                    requesting: false,
                    error: null,
                    success: true,
                    callLogs: action.payload.data,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip,
                    deleteRequest: false,
                    deleted: false,
                },
            });

        case FETCH_CALLLOGS_FAILURE:
            return Object.assign({}, state, {
                callLogs: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        // Search CallLog list.
        case SEARCH_CALLLOGS_REQUEST:
            return Object.assign({}, state, {
                searchCallLogs: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case SEARCH_CALLLOGS_SUCCESS:
            return Object.assign({}, state, {
                callLogs: {
                    requesting: false,
                    error: null,
                    success: true,
                    callLogs: action.payload.data,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip,
                    deleteRequest: false,
                    deleted: true,
                },
                searchCallLogs: {
                    requesting: false,
                    error: null,
                    success: true,
                },
            });

        case SEARCH_CALLLOGS_FAILURE:
            return Object.assign({}, state, {
                searchCallLogs: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        //Delete all Call logs
        case DELETE_ALL_CALLLOGS_REQUEST:
            return {
                ...state,
                callLogs: {
                    ...state.callLogs,
                    error: null,
                    success: false,
                    deleteRequest: true,
                },
            };

        case DELETE_ALL_CALLLOGS_SUCCESS:
            return Object.assign({}, state, {
                callLogs: {
                    requesting: false,
                    error: null,
                    success: true,
                    deleteRequest: false,
                    deleted: true,
                    callLogs: [],
                    count: null,
                    limit: null,
                    skip: null,
                },
            });

        case DELETE_ALL_CALLLOGS_FAILURE:
            return {
                ...state,
                callLogs: {
                    ...state.callLogs,
                    error: action.payload,
                    success: false,
                    deleteRequest: false,
                },
            };
        case FETCH_CALLLOG_STATUS_REQUEST:
            return Object.assign({}, state, {
                callLogStatus: {
                    error: null,
                    requesting: true,
                    success: false,
                    data: null,
                },
            });

        case FETCH_CALLLOG_STATUS_SUCCESS: {
            return Object.assign({}, state, {
                callLogStatus: {
                    error: null,
                    requesting: false,
                    success: true,
                    data: {
                        ...action.payload,
                    },
                },
            });
        }

        case FETCH_CALLLOG_STATUS_FAILED:
            return Object.assign({}, state, {
                callLogStatus: {
                    ...state.callLogStatus,
                    error: action.payload,
                    requesting: false,
                    success: false,
                },
            });

        case FETCH_CALLLOG_STATUS_RESET:
            return Object.assign({}, state, {
                callLogStatus: {
                    error: null,
                    requesting: false,
                    success: false,
                    data: null,
                },
            });
        case CHANGE_CALLLOG_STATUS_REQUEST:
            return Object.assign({}, state, {
                changeCallLogStatus: {
                    error: null,
                    requesting: true,
                    success: false,
                },
            });

        case CHANGE_CALLLOG_STATUS_SUCCESS: {
            return Object.assign({}, state, {
                callLogStatus: {
                    error: null,
                    requesting: false,
                    success: true,
                    data: {
                        ...action.payload,
                    },
                },
                changeCallLogStatus: {
                    error: null,
                    requesting: false,
                    success: true,
                },
            });
        }

        case CHANGE_CALLLOG_STATUS_FAILED:
            return Object.assign({}, state, {
                changeCallLogStatus: {
                    error: action.payload,
                    requesting: false,
                    success: false,
                },
            });

        case CHANGE_CALLLOG_STATUS_RESET:
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
