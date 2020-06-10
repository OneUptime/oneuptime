import {
    FETCH_LOGS_FAILURE,
    FETCH_LOGS_REQUEST,
    FETCH_LOGS_RESET,
    FETCH_LOGS_SUCCESS
} from '../constants/log';
import moment from 'moment';


const INITIAL_STATE = {
    logsList: {
        logs: [],
        error: null,
        requesting: false,
        success: false,
        startDate: moment().subtract(30, 'd'),
        endDate: moment(),
    },
};

export default function log(state = INITIAL_STATE, action) {
    let logs;
    switch (action.type) {
        case FETCH_LOGS_SUCCESS:
            // get all available logs
            logs = state.logsList.logs;

            // check if any log exist with the application log name
            const currentLog = logs.filter(log => log.applicationLogId === action.payload.applicationLogId);
            // if it exist, replace the content with the new content from the api
            if(currentLog.length > 0){
                logs = logs.map(log => {
                    if(log.applicationLogId === action.payload.applicationLogId) {
                        log.logs =  action.payload.logs;
                    }
                    return log;
                })
            }else {
                // if it doesnt merge the content from the api with the available ones
                logs = [...logs, action.payload]
            }
            return Object.assign({}, state, {
                logsList: {
                    ...state.logsList,
                    requesting: false,
                    error: null,
                    success: false,
                    logs: logs, // pass into statee
                },
            });

        case FETCH_LOGS_FAILURE:
            return Object.assign({}, state, {
                logsList: {
                    ...state.logsList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case FETCH_LOGS_RESET:
            return Object.assign({}, state, {
                logsList: INITIAL_STATE.logsList,
            });

        case FETCH_LOGS_REQUEST:
            return Object.assign({}, state, {
                logsList: {
                    ...state.logsList,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });
        default:
            return state;
    }
}