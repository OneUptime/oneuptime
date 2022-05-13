import {
    FETCH_SMSLOGS_REQUEST,
    FETCH_SMSLOGS_SUCCESS,
    FETCH_SMSLOGS_FAILURE,
    SEARCH_SMSLOGS_REQUEST,
    SEARCH_SMSLOGS_SUCCESS,
    SEARCH_SMSLOGS_FAILURE,
    DELETE_ALL_SMSLOGS_REQUEST,
    DELETE_ALL_SMSLOGS_SUCCESS,
    DELETE_ALL_SMSLOGS_FAILURE,
    FETCH_SMSLOG_STATUS_FAILED,
    FETCH_SMSLOG_STATUS_REQUEST,
    FETCH_SMSLOG_STATUS_SUCCESS,
    FETCH_SMSLOG_STATUS_RESET,
    CHANGE_SMSLOG_STATUS_FAILED,
    CHANGE_SMSLOG_STATUS_REQUEST,
    CHANGE_SMSLOG_STATUS_RESET,
    CHANGE_SMSLOG_STATUS_SUCCESS,
} from '../constants/smsLogs';

import Action from 'CommonUI/src/Types/Action';

const INITIAL_STATE: $TSFixMe = {
    smsLogs: {
        error: null,
        requesting: false,
        success: false,
        smsLogs: [],
        count: null,
        limit: null,
        skip: null,
        deleteRequest: false,
        deleted: false,
    },
    searchSmsLogs: {
        requesting: false,
        error: null,
        success: false,
    },
    smsLogStatus: {
        error: null,
        requesting: false,
        success: false,
        data: null,
    },
    changeSmsLogStatus: {
        error: null,
        requesting: false,
        success: false,
    },
};

export default function project(
    state: $TSFixMe = INITIAL_STATE,
    action: Action
): void {
    switch (action.type) {
        // Fetch smsLogs list
        case FETCH_SMSLOGS_REQUEST:
            return Object.assign({}, state, {
                smsLogs: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case FETCH_SMSLOGS_SUCCESS:
            return Object.assign({}, state, {
                smsLogs: {
                    requesting: false,
                    error: null,
                    success: true,
                    smsLogs: action.payload.data,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip,
                    deleteRequest: false,
                    deleted: false,
                },
            });

        case FETCH_SMSLOGS_FAILURE:
            return Object.assign({}, state, {
                smsLogs: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        // Search SmsLog list.
        case SEARCH_SMSLOGS_REQUEST:
            return Object.assign({}, state, {
                searchSmsLogs: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case SEARCH_SMSLOGS_SUCCESS:
            return Object.assign({}, state, {
                smsLogs: {
                    requesting: false,
                    error: null,
                    success: true,
                    smsLogs: action.payload.data,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip,
                    deleteRequest: false,
                    deleted: true,
                },
                searchSmsLogs: {
                    requesting: false,
                    error: null,
                    success: true,
                },
            });

        case SEARCH_SMSLOGS_FAILURE:
            return Object.assign({}, state, {
                searchSmsLogs: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        //Delete all Sms logs
        case DELETE_ALL_SMSLOGS_REQUEST:
            return {
                ...state,
                smsLogs: {
                    ...state.smsLogs,
                    error: null,
                    success: false,
                    deleteRequest: true,
                },
            };

        case DELETE_ALL_SMSLOGS_SUCCESS:
            return Object.assign({}, state, {
                smsLogs: {
                    requesting: false,
                    error: null,
                    success: true,
                    deleteRequest: false,
                    deleted: true,
                    smsLogs: [],
                    count: null,
                    limit: null,
                    skip: null,
                },
            });

        case DELETE_ALL_SMSLOGS_FAILURE:
            return {
                ...state,
                smsLogs: {
                    ...state.smsLogs,
                    error: action.payload,
                    success: false,
                    deleteRequest: false,
                },
            };
        case FETCH_SMSLOG_STATUS_REQUEST:
            return Object.assign({}, state, {
                smsLogStatus: {
                    error: null,
                    requesting: true,
                    success: false,
                    data: null,
                },
            });

        case FETCH_SMSLOG_STATUS_SUCCESS: {
            return Object.assign({}, state, {
                smsLogStatus: {
                    error: null,
                    requesting: false,
                    success: true,
                    data: {
                        ...action.payload,
                    },
                },
            });
        }

        case FETCH_SMSLOG_STATUS_FAILED:
            return Object.assign({}, state, {
                smsLogStatus: {
                    ...state.smsLogStatus,
                    error: action.payload,
                    requesting: false,
                    success: false,
                },
            });

        case FETCH_SMSLOG_STATUS_RESET:
            return Object.assign({}, state, {
                smsLogStatus: {
                    error: null,
                    requesting: false,
                    success: false,
                    data: null,
                },
            });
        case CHANGE_SMSLOG_STATUS_REQUEST:
            return Object.assign({}, state, {
                changeSmsLogStatus: {
                    error: null,
                    requesting: true,
                    success: false,
                },
            });

        case CHANGE_SMSLOG_STATUS_SUCCESS: {
            return Object.assign({}, state, {
                smsLogStatus: {
                    error: null,
                    requesting: false,
                    success: true,
                    data: {
                        ...action.payload,
                    },
                },
                changeSmsLogStatus: {
                    error: null,
                    requesting: false,
                    success: true,
                },
            });
        }

        case CHANGE_SMSLOG_STATUS_FAILED:
            return Object.assign({}, state, {
                changeSmsLogStatus: {
                    error: action.payload,
                    requesting: false,
                    success: false,
                },
            });

        case CHANGE_SMSLOG_STATUS_RESET:
            return Object.assign({}, state, {
                changeSmsLogStatus: {
                    error: null,
                    requesting: false,
                    success: false,
                },
            });

        default:
            return state;
    }
}
