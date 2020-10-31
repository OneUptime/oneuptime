import {
    CREATE_ERROR_TRACKER_FAILURE,
    CREATE_ERROR_TRACKER_REQUEST,
    CREATE_ERROR_TRACKER_RESET,
    CREATE_ERROR_TRACKER_SUCCESS,
    FETCH_ERROR_TRACKERS_FAILURE,
    FETCH_ERROR_TRACKERS_REQUEST,
    FETCH_ERROR_TRACKERS_RESET,
    FETCH_ERROR_TRACKERS_SUCCESS,
} from '../constants/errorTracker';

const INITIAL_STATE = {
    newErrorTracker: {
        errorTracker: null,
        error: null,
        requesting: false,
        success: false,
        initialValue: null,
    },
    errorTrackersList: {
        errorTrackers: [],
        error: null,
        requesting: false,
        success: false,
    },
};
export default function errorTracker(state = INITIAL_STATE, action) {
    switch (action.type) {
        case CREATE_ERROR_TRACKER_SUCCESS:
            return Object.assign({}, state, {
                newErrorTracker: INITIAL_STATE.newErrorTracker,
                errorTrackersList: {
                    ...state.errorTrackersList,
                    errorTrackers: [action.payload].concat(
                        state.errorTrackersList.errorTrackers
                    ),
                },
            });
        case CREATE_ERROR_TRACKER_FAILURE:
            return Object.assign({}, state, {
                newErrorTracker: {
                    ...state.newErrorTracker,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case CREATE_ERROR_TRACKER_RESET:
            return Object.assign({}, state, {
                newErrorTracker: INITIAL_STATE.newErrorTracker,
            });

        case CREATE_ERROR_TRACKER_REQUEST:
            return Object.assign({}, state, {
                newErrorTracker: {
                    ...state.newErrorTracker,
                    requesting: true,
                },
            });
        case FETCH_ERROR_TRACKERS_SUCCESS:
            return Object.assign({}, state, {
                errorTrackersList: {
                    ...state.errorTrackersList,
                    requesting: false,
                    error: null,
                    success: true,
                    errorTrackers: action.payload,
                },
            });

        case FETCH_ERROR_TRACKERS_FAILURE:
            return Object.assign({}, state, {
                errorTrackersList: {
                    ...state.errorTrackersList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case FETCH_ERROR_TRACKERS_RESET:
            return Object.assign({}, state, {
                errorTrackersList: INITIAL_STATE.errorTrackersList,
            });

        case FETCH_ERROR_TRACKERS_REQUEST:
            return Object.assign({}, state, {
                errorTrackersList: {
                    ...state.errorTrackersList,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });
        default:
            return state;
    }
}
