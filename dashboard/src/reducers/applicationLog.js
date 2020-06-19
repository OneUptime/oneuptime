import {
    CREATE_APPLICATION_LOG_FAILURE,
    CREATE_APPLICATION_LOG_REQUEST,
    CREATE_APPLICATION_LOG_RESET,
    CREATE_APPLICATION_LOG_SUCCESS,
    FETCH_APPLICATION_LOGS_FAILURE,
    FETCH_APPLICATION_LOGS_REQUEST,
    FETCH_APPLICATION_LOGS_RESET,
    FETCH_APPLICATION_LOGS_SUCCESS,
    DELETE_APPLICATION_LOG_FAILURE,
    DELETE_APPLICATION_LOG_REQUEST,
    DELETE_APPLICATION_LOG_SUCCESS,
    DELETE_COMPONENT_APPLICATION_LOGS,
    FETCH_LOGS_FAILURE,
    FETCH_LOGS_REQUEST,
    FETCH_LOGS_RESET,
    FETCH_LOGS_SUCCESS,
    RESET_APPLICATION_LOG_KEY_FAILURE,
    RESET_APPLICATION_LOG_KEY_REQUEST,
    RESET_APPLICATION_LOG_KEY_RESET,
    RESET_APPLICATION_LOG_KEY_SUCCESS,
    EDIT_APPLICATION_LOG_SWITCH,
    EDIT_APPLICATION_LOG_FAILURE,
    EDIT_APPLICATION_LOG_REQUEST,
    EDIT_APPLICATION_LOG_RESET,
    EDIT_APPLICATION_LOG_SUCCESS,
} from '../constants/applicationLog';
import moment from 'moment';

const INITIAL_STATE = {
    newApplicationLog: {
        applicationLog: null,
        error: null,
        requesting: false,
        success: false,
        initialValue: null,
    },
    applicationLogsList: {
        applicationLogs: [],
        error: null,
        requesting: false,
        success: false,
        startDate: moment().subtract(30, 'd'),
        endDate: moment(),
    },
    logs: {},
    editApplicationLog: {
        requesting: false,
        error: null,
        success: false,
    },
};
export default function applicationLog(state = INITIAL_STATE, action) {
    let applicationLogs, failureLogs, requestLogs;
    switch (action.type) {
        case CREATE_APPLICATION_LOG_SUCCESS:
            return Object.assign({}, state, {
                newApplicationLog: INITIAL_STATE.newApplicationLog,
                applicationLogsList: {
                    ...state.applicationLogsList,
                    applicationLogs: [action.payload].concat(
                        state.applicationLogsList.applicationLogs
                    ),
                },
            });
        case CREATE_APPLICATION_LOG_FAILURE:
            return Object.assign({}, state, {
                newApplicationLog: {
                    ...state.newApplicationLog,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case CREATE_APPLICATION_LOG_RESET:
            return Object.assign({}, state, {
                newApplicationLog: INITIAL_STATE.newApplicationLog,
            });

        case CREATE_APPLICATION_LOG_REQUEST:
            return Object.assign({}, state, {
                newApplicationLog: {
                    ...state.newApplicationLog,
                    requesting: true,
                },
            });
        case FETCH_APPLICATION_LOGS_SUCCESS:
            return Object.assign({}, state, {
                applicationLogsList: {
                    ...state.applicationLogsList,
                    requesting: false,
                    error: null,
                    success: false,
                    applicationLogs: action.payload,
                },
            });

        case FETCH_APPLICATION_LOGS_FAILURE:
            return Object.assign({}, state, {
                applicationLogsList: {
                    ...state.applicationLogsList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case FETCH_APPLICATION_LOGS_RESET:
            return Object.assign({}, state, {
                applicationLogsList: INITIAL_STATE.applicationLogsList,
            });

        case FETCH_APPLICATION_LOGS_REQUEST:
            return Object.assign({}, state, {
                applicationLogsList: {
                    ...state.applicationLogsList,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case DELETE_APPLICATION_LOG_SUCCESS:
            return Object.assign({}, state, {
                applicationLogsList: {
                    ...state.applicationLogsList,
                    requesting: false,
                    error: null,
                    success: false,
                    applicationLogs: state.applicationLogsList.applicationLogs.filter(
                        ({ _id }) => _id !== action.payload
                    ),
                },
                deleteApplicationLog: false,
            });

        case DELETE_APPLICATION_LOG_FAILURE:
            return Object.assign({}, state, {
                applicationLogsList: {
                    ...state.applicationLogsList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
                deleteApplicationLog: false,
            });

        case DELETE_APPLICATION_LOG_REQUEST:
            return Object.assign({}, state, {
                applicationLogsList: {
                    ...state.applicationLogsList,
                    requesting: false,
                    error: null,
                    success: false,
                },
                deleteApplicationLog: action.payload,
            });

        case DELETE_COMPONENT_APPLICATION_LOGS:
            applicationLogs = Object.assign(
                [],
                state.applicationLogsList.applicationLogs
            );
            applicationLogs = applicationLogs.filter(
                applicationLog => action.payload !== applicationLog.componentId
            );

            return Object.assign({}, state, {
                applicationLogsList: {
                    ...state.applicationLogsList,
                    applicationLogs,
                    error: null,
                    loading: false,
                },
            });
        case FETCH_LOGS_SUCCESS:
            return Object.assign({}, state, {
                logs: {
                    ...state.logs,
                    [action.payload.applicationLogId]: {
                        logs: action.payload.logs,
                        error: null,
                        requesting: false,
                        success: false,
                        skip: action.payload.skip,
                        limit: action.payload.limit,
                        count: action.payload.count,
                    },
                },
            });

        case FETCH_LOGS_FAILURE:
            failureLogs = {
                ...state.logs,
                [action.payload.applicationLogId]: state.logs[
                    action.payload.applicationLogId
                ]
                    ? {
                          ...state.logs[action.payload.applicationLogId],
                          error: action.payload.error,
                      }
                    : {
                          logs: [],
                          error: action.payload.error,
                          requesting: false,
                          success: false,
                          skip: 0,
                          limit: 10,
                          count: null,
                      },
            };
            return Object.assign({}, state, {
                logs: failureLogs,
            });

        case FETCH_LOGS_REQUEST:
            requestLogs = {
                ...state.logs,
                [action.payload.applicationLogId]: state.logs[
                    action.payload.applicationLogId
                ]
                    ? {
                          ...state.logs[action.payload.applicationLogId],
                          requesting: true,
                      }
                    : {
                          logs: [],
                          error: null,
                          requesting: true,
                          success: false,
                          skip: 0,
                          limit: 10,
                          count: null,
                      },
            };
            return Object.assign({}, state, {
                logs: requestLogs,
            });

        case FETCH_LOGS_RESET:
            return Object.assign({}, state, {
                logs: INITIAL_STATE.logs,
            });
        case RESET_APPLICATION_LOG_KEY_SUCCESS:
            applicationLogs = state.applicationLogsList.applicationLogs.map(
                applicationLog => {
                    if (applicationLog._id === action.payload._id) {
                        applicationLog = action.payload;
                    }
                    return applicationLog;
                }
            );
            return Object.assign({}, state, {
                applicationLogsList: {
                    ...state.applicationLogsList,
                    requesting: false,
                    error: null,
                    success: false,
                    applicationLogs: applicationLogs,
                },
            });

        case RESET_APPLICATION_LOG_KEY_FAILURE:
            return Object.assign({}, state, {
                applicationLogsList: {
                    ...state.applicationLogsList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case RESET_APPLICATION_LOG_KEY_RESET:
            return Object.assign({}, state, {
                applicationLogsList: INITIAL_STATE.applicationLogsList,
            });

        case RESET_APPLICATION_LOG_KEY_REQUEST:
            return Object.assign({}, state, {
                applicationLogsList: {
                    ...state.applicationLogsList,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });
        case EDIT_APPLICATION_LOG_SWITCH:
            applicationLogs = state.applicationLogsList.applicationLogs.map(
                applicationLog => {
                    if (applicationLog._id === action.payload) {
                        if (!applicationLog.editMode)
                            applicationLog.editMode = true;
                        else applicationLog.editMode = false;
                    } else {
                        applicationLog.editMode = false;
                    }
                    return applicationLog;
                }
            );
            return Object.assign({}, state, {
                applicationLogsList: {
                    ...state.applicationLogsList,
                    requesting: false,
                    error: null,
                    success: false,
                    applicationLogs: applicationLogs,
                },
                editApplicationLog: {
                    requesting: false,
                    error: null,
                    success: false,
                },
            });
        case EDIT_APPLICATION_LOG_SUCCESS:
            applicationLogs = state.applicationLogsList.applicationLogs.map(
                applicationLog => {
                    if (applicationLog._id === action.payload._id) {
                        applicationLog = action.payload;
                    }
                    return applicationLog;
                }
            );
            return Object.assign({}, state, {
                applicationLogsList: {
                    ...state.applicationLogsList,
                    requesting: false,
                    error: null,
                    success: false,
                    applicationLogs: applicationLogs,
                },
            });
        case EDIT_APPLICATION_LOG_FAILURE:
            return Object.assign({}, state, {
                editApplicationLog: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case EDIT_APPLICATION_LOG_RESET:
            return Object.assign({}, state, {
                editApplicationLog: INITIAL_STATE.editApplicationLog,
            });

        case EDIT_APPLICATION_LOG_REQUEST:
            return Object.assign({}, state, {
                editApplicationLog: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        default:
            return state;
    }
}
