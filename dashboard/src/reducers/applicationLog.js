import {
    CREATE_APPLICATION_LOG_FAILURE,
    CREATE_APPLICATION_LOG_REQUEST,
    CREATE_APPLICATION_LOG_RESET,
    CREATE_APPLICATION_LOG_SUCCESS
} from '../constants/applicationLog';
const INITIAL_STATE = {
    newApplicationLog: {
        applicationLog: null,
        error: null,
        requesting: false,
        success: false,
        initialValue: null,
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
        default:
            return state;
    }
}
