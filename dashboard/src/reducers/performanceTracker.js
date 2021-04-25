import moment from 'moment';
import * as types from '../constants/performanceTracker';

const INITIAL_STATE = {
    dates: {
        startDate: moment().subtract(30, 'd'),
        endDate: moment(),
    },
    performanceTrackerList: {
        requesting: false,
        success: false,
        error: null,
        performanceTrackers: [],
        skip: 0,
        limit: 0,
        count: 0,
    },
    updatePerformanceTracker: {
        requesting: false,
        success: false,
        error: null,
        performanceTracker: null,
    },
    deletePerformanceTracker: {
        requesting: false,
        success: false,
        error: null,
        performanceTracker: null,
    },
    resetPerformanceTrackerKey: {
        requesting: false,
        success: false,
        error: null,
        performanceTracker: null,
    },
    newPerformanceTracker: {
        requesting: false,
        success: false,
        error: null,
        performanceTracker: null,
    },
    fetchPerformanceTracker: {
        requesting: false,
        success: false,
        error: null,
        performanceTracker: null,
    },
};

export default function(state = INITIAL_STATE, action) {
    switch (action.type) {
        case 'SET_START_DATE':
            return {
                ...state,
                dates: {
                    ...state.dates,
                    startDate: action.payload,
                },
            };

        case 'SET_END_DATE':
            return {
                ...state,
                dates: {
                    ...state.dates,
                    endDate: action.payload,
                },
            };

        case types.CREATE_PERFORMANCE_TRACKER_REQUEST:
            return {
                ...state,
                newPerformanceTracker: {
                    ...state.newPerformanceTracker,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.CREATE_PERFORMANCE_TRACKER_SUCCESS:
            return {
                ...state,
                newPerformanceTracker: {
                    requesting: false,
                    success: true,
                    error: null,
                    performanceTracker: action.payload,
                },
            };

        case types.CREATE_PERFORMANCE_TRACKER_FAILURE:
            return {
                ...state,
                newPerformanceTracker: {
                    ...state.newPerformanceTracker,
                    success: false,
                    requesting: false,
                    error: action.payload,
                },
            };

        case types.CREATE_PERFORMANCE_TRACKER_RESET:
            return {
                ...state,
                newPerformanceTracker: {
                    ...INITIAL_STATE.newPerformanceTracker,
                },
            };

        case types.FETCH_PERFORMANCE_TRACKER_REQUEST:
            return {
                ...state,
                fetchPerformanceTracker: {
                    ...state.fetchPerformanceTracker,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.FETCH_PERFORMANCE_TRACKER_SUCCESS:
            return {
                ...state,
                fetchPerformanceTracker: {
                    requesting: false,
                    error: null,
                    success: true,
                    performanceTracker: action.payload,
                },
            };

        case types.FETCH_PERFORMANCE_TRACKER_FAILURE:
            return {
                ...state,
                fetchPerformanceTracker: {
                    ...state.fetchPerformanceTracker,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.FETCH_PERFORMANCE_TRACKER_RESET:
            return {
                ...state,
                fetchPerformanceTracker: {
                    ...INITIAL_STATE.fetchPerformanceTracker,
                },
            };

        case types.FETCH_PERFORMANCE_TRACKERS_REQUEST:
            return {
                ...state,
                performanceTrackerList: {
                    ...state.performanceTrackerList,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.FETCH_PERFORMANCE_TRACKERS_SUCCESS:
            return {
                ...state,
                performanceTrackerList: {
                    requesting: false,
                    error: null,
                    success: true,
                    performanceTrackers: action.payload.data,
                    skip: action.payload.skip,
                    limit: action.payload.limit,
                    count: action.payload.count,
                },
            };

        case types.FETCH_PERFORMANCE_TRACKERS_FAILURE:
            return {
                ...state,
                performanceTrackerList: {
                    ...state.performanceTrackerList,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.FETCH_PERFORMANCE_TRACKERS_RESET:
            return {
                ...state,
                performanceTrackerList: {
                    ...INITIAL_STATE.performanceTrackerList,
                },
            };

        case types.UPDATE_PERFORMANCE_TRACKER_REQUEST:
            return {
                ...state,
                updatePerformanceTracker: {
                    ...state.updatePerformanceTracker,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.UPDATE_PERFORMANCE_TRACKER_SUCCESS:
            return {
                ...state,
                updatePerformanceTracker: {
                    requesting: false,
                    success: true,
                    error: null,
                    performanceTracker: action.payload,
                },
            };

        case types.UPDATE_PERFORMANCE_TRACKER_FAILURE:
            return {
                ...state,
                updatePerformanceTracker: {
                    ...state.updatePerformanceTracker,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.UPDATE_PERFORMANCE_TRACKER_RESET:
            return {
                ...state,
                updatePerformanceTracker: {
                    ...INITIAL_STATE.updatePerformanceTracker,
                },
            };

        case types.DELETE_PERFORMANCE_TRACKER_REQUEST:
            return {
                ...state,
                deletePerformanceTracker: {
                    ...state.deletePerformanceTracker,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.DELETE_PERFORMANCE_TRACKER_SUCCESS:
            return {
                ...state,
                deletePerformanceTracker: {
                    requesting: false,
                    success: true,
                    error: null,
                    performanceTracker: action.payload,
                },
            };

        case types.DELETE_PERFORMANCE_TRACKER_FAILURE:
            return {
                ...state,
                deletePerformanceTracker: {
                    ...state.deletePerformanceTracker,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.DELETE_PERFORMANCE_TRACKER_RESET:
            return {
                ...state,
                deletePerformanceTracker: {
                    ...INITIAL_STATE.deletePerformanceTracker,
                },
            };

        case types.RESET_PERFORMANCE_TRACKER_KEY_REQUEST:
            return {
                ...state,
                resetPerformanceTrackerKey: {
                    ...state.resetPerformanceTrackerKey,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.RESET_PERFORMANCE_TRACKER_KEY_SUCCESS:
            return {
                ...state,
                resetPerformanceTrackerKey: {
                    requesting: false,
                    success: true,
                    error: null,
                    performanceTracker: action.payload,
                },
                fetchPerformanceTracker: {
                    ...state.fetchPerformanceTracker,
                    performanceTracker: action.payload,
                },
            };

        case types.RESET_PERFORMANCE_TRACKER_KEY_FAILURE:
            return {
                ...state,
                resetPerformanceTrackerKey: {
                    ...state.resetPerformanceTrackerKey,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.RESET_PERFORMANCE_TRACKER_KEY_RESET:
            return {
                ...state,
                resetPerformanceTrackerKey: {
                    ...INITIAL_STATE.resetPerformanceTrackerKey,
                },
            };

        default:
            return state;
    }
}
