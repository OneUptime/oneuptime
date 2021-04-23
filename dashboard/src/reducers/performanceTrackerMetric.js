import * as types from '../constants/performanceTrackerMetric';
import moment from 'moment';

// set default date
// last 30 days from today
const currentDate = moment(Date.now())
    .utc()
    .format();
const startDate = moment(currentDate)
    .subtract(30, 'days')
    .utc()
    .format();
const INITIAL_STATE = {
    timeStartDate: startDate,
    timeEndDate: currentDate,
    throughputStartDate: startDate,
    throughputEndDate: currentDate,
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
};

export default function(state = INITIAL_STATE, action) {
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
                    ...state.timeMetrics,
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

        default:
            return state;
    }
}
