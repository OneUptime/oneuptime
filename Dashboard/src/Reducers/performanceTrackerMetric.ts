import * as types from '../constants/performanceTrackerMetric';

import Action from 'CommonUI/src/types/action';

const INITIAL_STATE = {
    timeStartDate: null,
    timeEndDate: null,
    throughputStartDate: null,
    throughputEndDate: null,
    incomingStartDate: null,
    incomingEndDate: null,
    outgoingStartDate: null,
    outgoingEndDate: null,
    timeMetrics: {
        requesting: false,
        success: false,
        error: null,
        metrics: [],
    },
    throughputMetrics: {
        requesting: false,
        success: false,
        error: null,
        metrics: [],
    },
    errorMetrics: {
        requesting: false,
        error: null,
        success: false,
        metrics: [],
    },
    incomingMetrics: {
        requesting: false,
        success: false,
        error: null,
        skip: 0,
        limit: 10,
        count: 0,
        metrics: [],
    },
    outgoingMetrics: {
        requesting: false,
        success: false,
        error: null,
        skip: 0,
        limit: 10,
        count: 0,
        metrics: [],
    },
    deleteIncomingMetrics: {
        requesting: false,
        success: false,
        error: null,
    },
    deleteOutgoingMetrics: {
        requesting: false,
        success: false,
        error: null,
    },
};

export default function (state = INITIAL_STATE, action: Action) {
    switch (action.type) {
        case types.SET_TIME_STARTDATE:
            return {
                ...state,
                timeStartDate: action.payload,
            };

        case types.SET_TIME_ENDDATE:
            return {
                ...state,
                timeEndDate: action.payload,
            };

        case types.SET_THROUGHPUT_STARTDATE:
            return {
                ...state,
                throughputStartDate: action.payload,
            };

        case types.SET_THROUGHPUT_ENDDATE:
            return {
                ...state,
                throughputEndDate: action.payload,
            };

        case types.RESET_TIME_DATE:
            return {
                ...state,
                timeStartDate: action.payload.startDate,
                timeEndDate: action.payload.endDate,
            };

        case types.RESET_THROUGHPUT_DATE:
            return {
                ...state,
                throughputStartDate: action.payload.startDate,
                throughputEndDate: action.payload.endDate,
            };

        case types.RESET_INCOMING_DATE:
            return {
                ...state,
                incomingStartDate: action.payload.startDate,
                incomingEndDate: action.payload.endDate,
            };

        case types.RESET_OUTGOING_DATE:
            return {
                ...state,
                outgoingStartDate: action.payload.startDate,
                outgoingEndDate: action.payload.endDate,
            };

        case types.FETCH_TIME_METRICS_REQUEST:
            return {
                ...state,
                timeMetrics: {
                    ...state.timeMetrics,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.FETCH_TIME_METRICS_SUCCESS:
            return {
                ...state,
                timeMetrics: {
                    requesting: false,
                    success: true,
                    error: null,
                    metrics: action.payload, // update the data
                },
            };

        case types.UPDATE_TIME_METRICS:
            return {
                ...state,
                timeMetrics: {
                    ...state.timeMetrics,
                    metrics: state.timeMetrics.metrics.concat(
                        ...action.payload
                    ),
                },
            };

        case types.FETCH_TIME_METRICS_FAILURE:
            return {
                ...state,
                timeMetrics: {
                    ...state.timeMetrics,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.FETCH_THROUGHPUT_METRICS_REQUEST:
            return {
                ...state,
                throughputMetrics: {
                    ...state.throughputMetrics,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.FETCH_THROUGHPUT_METRICS_SUCCESS:
            return {
                ...state,
                throughputMetrics: {
                    requesting: false,
                    success: true,
                    error: null,
                    metrics: action.payload, // update the data
                },
            };

        case types.UPDATE_THROUGHPUT_METRICS:
            return {
                ...state,
                throughputMetrics: {
                    ...state.throughputMetrics,
                    metrics: state.throughputMetrics.metrics.concat(
                        ...action.payload
                    ),
                },
            };

        case types.FETCH_THROUGHPUT_METRICS_FAILURE:
            return {
                ...state,
                throughputMetrics: {
                    ...state.throughputMetrics,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.FETCH_ERROR_METRICS_REQUEST:
            return {
                ...state,
                errorMetrics: {
                    ...state.errorMetrics,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.FETCH_ERROR_METRICS_SUCCESS:
            return {
                ...state,
                errorMetrics: {
                    requesting: false,
                    success: true,
                    error: null,
                    metrics: action.payload, // update the data
                },
            };

        case types.UPDATE_ERROR_METRICS:
            return {
                ...state,
                errorMetrics: {
                    ...state.errorMetrics,
                    metrics: state.errorMetrics.metrics.concat(
                        ...action.payload
                    ),
                },
            };

        case types.FETCH_ERROR_METRICS_FAILURE:
            return {
                ...state,
                errorMetrics: {
                    ...state.errorMetrics,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.SET_INCOMING_STARTDATE:
            return {
                ...state,
                incomingStartDate: action.payload,
            };

        case types.SET_INCOMING_ENDDATE:
            return {
                ...state,
                incomingEndDate: action.payload,
            };

        case types.SET_OUTGOING_STARTDATE:
            return {
                ...state,
                outgoingStartDate: action.payload,
            };

        case types.SET_OUTGOING_ENDDATE:
            return {
                ...state,
                outgoingEndDate: action.payload,
            };

        case types.FETCH_INCOMING_METRICS_REQUEST:
            return {
                ...state,
                incomingMetrics: {
                    ...state.incomingMetrics,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.FETCH_INCOMING_METRICS_SUCCESS:
            return {
                ...state,
                incomingMetrics: {
                    ...state.incomingMetrics,
                    requesting: false,
                    success: true,
                    error: null,
                    count: action.payload.length,
                    metrics: action.payload,
                },
            };

        case types.FETCH_INCOMING_METRICS_FAILURE:
            return {
                ...state,
                incomingMetrics: {
                    ...state.incomingMetrics,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.FETCH_OUTGOING_METRICS_REQUEST:
            return {
                ...state,
                outgoingMetrics: {
                    ...state.outgoingMetrics,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.FETCH_OUTGOING_METRICS_SUCCESS:
            return {
                ...state,
                outgoingMetrics: {
                    ...state.outgoingMetrics,
                    requesting: false,
                    success: true,
                    error: null,
                    count: action.payload.length,
                    metrics: action.payload,
                },
            };

        case types.FETCH_OUTGOING_METRICS_FAILURE:
            return {
                ...state,
                outgoingMetrics: {
                    ...state.outgoingMetrics,
                    requesting: false,
                    success: false,
                    error: null,
                },
            };

        case types.RESET_INCOMING_DELETE:
            return {
                ...state,
                deleteIncomingMetrics: {
                    ...INITIAL_STATE.deleteIncomingMetrics,
                },
            };

        case types.RESET_OUTGOING_DELETE:
            return {
                ...state,
                deleteOutgoingMetrics: {
                    ...INITIAL_STATE.deleteOutgoingMetrics,
                },
            };

        case types.DELETE_INCOMING_METRICS_REQUEST:
            return {
                ...state,
                deleteIncomingMetrics: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.DELETE_INCOMING_METRICS_SUCCESS:
            return {
                ...state,
                deleteIncomingMetrics: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            };

        case types.DELETE_INCOMING_METRICS_FAILURE:
            return {
                ...state,
                deleteIncomingMetrics: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.DELETE_OUTGOING_METRICS_REQUEST:
            return {
                ...state,
                deleteOutgoingMetrics: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.DELETE_OUTGOING_METRICS_SUCCESS:
            return {
                ...state,
                deleteOutgoingMetrics: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            };

        case types.DELETE_OUTGOING_METRICS_FAILURE:
            return {
                ...state,
                deleteOutgoingMetrics: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        default:
            return state;
    }
}
