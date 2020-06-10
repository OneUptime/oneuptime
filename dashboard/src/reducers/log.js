import {
    FETCH_LOGS_FAILURE,
    FETCH_LOGS_REQUEST,
    FETCH_LOGS_RESET
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
    switch (action.type) {
        // case FETCH_LOGS_SUCCESS:
        //     return Object.assign({}, state, {
        //         logsList: {
        //             ...state.logsList,
        //             requesting: false,
        //             error: null,
        //             success: false,
        //             logs: state.logsList.logs.concat(action.payload),
        //         },
        //     });

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