import {
    CREATE_APPLICATION_LOG_FAILURE,
    CREATE_APPLICATION_LOG_REQUEST,
    CREATE_APPLICATION_LOG_RESET,
    CREATE_APPLICATION_LOG_SUCCESS,
    FETCH_APPLICATION_LOGS_FAILURE,
    FETCH_APPLICATION_LOGS_REQUEST,
    FETCH_APPLICATION_LOGS_RESET,
    FETCH_APPLICATION_LOGS_SUCCESS,
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
};
export default function applicationLog(state = INITIAL_STATE, action) {
    switch (action.type) {
        case CREATE_APPLICATION_LOG_SUCCESS:
            return Object.assign({}, state, {
                newApplicationLog: INITIAL_STATE.newApplicationLog,
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
        default:
            return state;
    }
}
