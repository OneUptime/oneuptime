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
    FETCH_LOG_STAT_FAILURE,
    FETCH_LOG_STAT_REQUEST,
    FETCH_LOG_STAT_RESET,
    FETCH_LOG_STAT_SUCCESS,
    GET_LOG_SUCCESS,
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
        paginatedRequest: false,
    },
    logs: {},
    editApplicationLog: {
        requesting: false,
        error: null,
        success: false,
    },
    stats: {},
};
export default function applicationLog(state = INITIAL_STATE, action: $TSFixMe) {
    let applicationLogs,
        failureLogs,
        requestLogs,
        failureStats,
        requestStats,
        logCount,
        typeCount;
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
                    success: true,
                    applicationLogs: action.payload.applicationLogs,
                    count: action.payload.count,
                    skip: action.payload.skip,
                    limit: action.payload.limit,
                    paginatedRequest: false,
                },
            });

        case FETCH_APPLICATION_LOGS_FAILURE:
            return Object.assign({}, state, {
                applicationLogsList: {
                    ...state.applicationLogsList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                    paginatedRequest: false,
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
                    requesting: action.payload ? false : true,
                    error: null,
                    success: false,
                    paginatedRequest: true,
                },
            });

        case DELETE_APPLICATION_LOG_SUCCESS:
            return Object.assign({}, state, {
                applicationLogsList: {
                    ...state.applicationLogsList,
                    requesting: false,
                    error: null,
                    success: true,
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'nev... Remove this comment to see the full error message
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
                        dateRange: action.payload.dateRange,
                        error: null,
                        requesting: false,
                        success: true,
                        skip: action.payload.skip,
                        limit: action.payload.limit,
                        count: action.payload.count,
                    },
                },
            });

        case FETCH_LOGS_FAILURE:
            failureLogs = {
                ...state.logs,
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                [action.payload.applicationLogId]: state.logs[
                    action.payload.applicationLogId
                ]
                    ? {
                          // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                [action.payload.applicationLogId]: state.logs[
                    action.payload.applicationLogId
                ]
                    ? {
                          // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
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
                    // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                    if (applicationLog._id === action.payload._id) {
                        // @ts-expect-error ts-migrate(2322) FIXME: Type 'any' is not assignable to type 'never'.
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
                    success: true,
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
                    // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                    if (applicationLog._id === action.payload) {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'editMode' does not exist on type 'never'... Remove this comment to see the full error message
                        if (!applicationLog.editMode)
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editMode' does not exist on type 'never'... Remove this comment to see the full error message
                            applicationLog.editMode = true;
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'editMode' does not exist on type 'never'... Remove this comment to see the full error message
                        else applicationLog.editMode = false;
                    } else {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'editMode' does not exist on type 'never'... Remove this comment to see the full error message
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
                    // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                    if (applicationLog._id === action.payload._id) {
                        // @ts-expect-error ts-migrate(2322) FIXME: Type 'any' is not assignable to type 'never'.
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
                    success: true,
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

        case FETCH_LOG_STAT_SUCCESS:
            return Object.assign({}, state, {
                stats: {
                    ...state.stats,
                    [action.payload.applicationLogId]: {
                        stats: action.payload.stats,
                        error: null,
                        requesting: false,
                        success: true,
                    },
                },
            });

        case FETCH_LOG_STAT_FAILURE:
            failureStats = {
                ...state.stats,
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                [action.payload.applicationLogId]: state.stats[
                    action.payload.applicationLogId
                ]
                    ? {
                          // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                          ...state.stats[action.payload.applicationLogId],
                          error: action.payload.error,
                      }
                    : {
                          stats: [],
                          error: action.payload.error,
                          requesting: false,
                          success: false,
                      },
            };
            return Object.assign({}, state, {
                stats: failureStats,
            });

        case FETCH_LOG_STAT_REQUEST:
            requestStats = {
                ...state.stats,
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                [action.payload.applicationLogId]: state.stats[
                    action.payload.applicationLogId
                ]
                    ? {
                          // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                          ...state.stats[action.payload.applicationLogId],
                          requesting: true,
                      }
                    : {
                          stats: [],
                          error: null,
                          requesting: true,
                          success: false,
                      },
            };
            return Object.assign({}, state, {
                stats: requestStats,
            });

        case FETCH_LOG_STAT_RESET:
            return Object.assign({}, state, {
                stats: INITIAL_STATE.stats,
            });
        case GET_LOG_SUCCESS:
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            requestLogs = state.logs[action.payload.applicationLogId._id].logs; // current logs
            logCount =
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                state.stats[action.payload.applicationLogId._id].stats.all || 0; // current count of all logs
            typeCount =
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                state.stats[action.payload.applicationLogId._id].stats[
                    action.payload.type
                ] || 0; // current count of all logs of that type
            if (
                requestLogs.filter((log: $TSFixMe) => log._id === action.payload._id)
                    .length > 0
            ) {
                // If the new log exist maybe the event was emitted twice or more, just replace
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                requestLogs = state.logs[
                    action.payload.applicationLogId._id
                ].logs.map((log: $TSFixMe) => {
                    if (log._id === action.payload._id) {
                        log = action.payload;
                    }
                    return log;
                });
            } else {
                // new log add to beginning of logs
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                requestLogs = state.logs[
                    action.payload.applicationLogId._id
                ].logs.concat([action.payload]);
                // update counts
                logCount += 1;
                typeCount += 1;
            }
            if (requestLogs.length > 10) requestLogs.pop();
            return Object.assign({}, state, {
                logs: {
                    ...state.logs,
                    [action.payload.applicationLogId._id]: {
                        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                        ...state.logs[action.payload.applicationLogId._id],
                        logs: requestLogs,
                        count: logCount,
                    },
                },
                stats: {
                    ...state.stats,
                    [action.payload.applicationLogId._id]: {
                        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                        ...state.stats[action.payload.applicationLogId._id],
                        stats: {
                            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                            ...state.stats[action.payload.applicationLogId._id]
                                .stats,
                            all: logCount,
                            [action.payload.type]: typeCount,
                        },
                    },
                },
            });
        default:
            return state;
    }
}
