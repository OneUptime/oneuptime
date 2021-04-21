import moment from 'moment';
import * as types from '../constants/performanceMonitor';

const INITIAL_STATE = {
    dates: {
        startDate: moment().subtract(30, 'd'),
        endDate: moment(),
    },
    performanceMonitorList: {
        requesting: false,
        success: false,
        error: null,
        performanceMonitors: [],
        skip: 0,
        limit: 0,
        count: 0,
    },
    updatePerformanceMonitor: {
        requesting: false,
        success: false,
        error: null,
        performanceMonitor: null,
    },
    deletePerformanceMonitor: {
        requesting: false,
        success: false,
        error: null,
        performanceMonitor: null,
    },
    resetPerformanceMonitorKey: {
        requesting: false,
        success: false,
        error: null,
        performanceMonitor: null,
    },
    newPerformanceMonitor: {
        requesting: false,
        success: false,
        error: null,
        performanceMonitor: null,
    },
    fetchPerformanceMonitor: {
        requesting: false,
        success: false,
        error: null,
        performanceMonitor: null,
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

        case types.CREATE_PERFORMANCE_MONITOR_REQUEST:
            return {
                ...state,
                newPerformanceMonitor: {
                    ...state.newPerformanceMonitor,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.CREATE_PERFORMANCE_MONITOR_SUCCESS:
            return {
                ...state,
                newPerformanceMonitor: {
                    requesting: false,
                    success: true,
                    error: null,
                    performanceMonitor: action.payload,
                },
            };

        case types.CREATE_PERFORMANCE_MONITOR_FAILURE:
            return {
                ...state,
                newPerformanceMonitor: {
                    ...state.newPerformanceMonitor,
                    success: false,
                    requesting: false,
                    error: action.payload,
                },
            };

        case types.CREATE_PERFORMANCE_MONITOR_RESET:
            return {
                ...state,
                newPerformanceMonitor: {
                    ...INITIAL_STATE.newPerformanceMonitor,
                },
            };

        case types.FETCH_PERFORMANCE_MONITOR_REQUEST:
            return {
                ...state,
                fetchPerformanceMonitor: {
                    ...state.fetchPerformanceMonitor,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.FETCH_PERFORMANCE_MONITOR_SUCCESS:
            return {
                ...state,
                fetchPerformanceMonitor: {
                    requesting: false,
                    error: null,
                    success: true,
                    performanceMonitor: action.payload,
                },
            };

        case types.FETCH_PERFORMANCE_MONITOR_FAILURE:
            return {
                ...state,
                fetchPerformanceMonitor: {
                    ...state.fetchPerformanceMonitor,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.FETCH_PERFORMANCE_MONITOR_RESET:
            return {
                ...state,
                fetchPerformanceMonitor: {
                    ...INITIAL_STATE.fetchPerformanceMonitor,
                },
            };

        case types.FETCH_PERFORMANCE_MONITORS_REQUEST:
            return {
                ...state,
                performanceMonitorList: {
                    ...state.performanceMonitorList,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.FETCH_PERFORMANCE_MONITORS_SUCCESS:
            return {
                ...state,
                performanceMonitorList: {
                    requesting: false,
                    error: null,
                    success: true,
                    performanceMonitors: action.payload.data,
                    skip: action.payload.skip,
                    limit: action.payload.limit,
                    count: action.payload.count,
                },
            };

        case types.FETCH_PERFORMANCE_MONITORS_FAILURE:
            return {
                ...state,
                performanceMonitorList: {
                    ...state.performanceMonitorList,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.FETCH_PERFORMANCE_MONITORS_RESET:
            return {
                ...state,
                performanceMonitorList: {
                    ...INITIAL_STATE.performanceMonitorList,
                },
            };

        case types.UPDATE_PERFORMANCE_MONITOR_REQUEST:
            return {
                ...state,
                updatePerformanceMonitor: {
                    ...state.updatePerformanceMonitor,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.UPDATE_PERFORMANCE_MONITOR_SUCCESS:
            return {
                ...state,
                updatePerformanceMonitor: {
                    requesting: false,
                    success: true,
                    error: null,
                    performanceMonitor: action.payload,
                },
            };

        case types.UPDATE_PERFORMANCE_MONITOR_FAILURE:
            return {
                ...state,
                updatePerformanceMonitor: {
                    ...state.updatePerformanceMonitor,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.UPDATE_PERFORMANCE_MONITOR_RESET:
            return {
                ...state,
                updatePerformanceMonitor: {
                    ...INITIAL_STATE.updatePerformanceMonitor,
                },
            };

        case types.DELETE_PERFORMANCE_MONITOR_REQUEST:
            return {
                ...state,
                deletePerformanceMonitor: {
                    ...state.deletePerformanceMonitor,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.DELETE_PERFORMANCE_MONITOR_SUCCESS:
            return {
                ...state,
                deletePerformanceMonitor: {
                    requesting: false,
                    success: true,
                    error: null,
                    performanceMonitor: action.payload,
                },
            };

        case types.DELETE_PERFORMANCE_MONITOR_FAILURE:
            return {
                ...state,
                deletePerformanceMonitor: {
                    ...state.deletePerformanceMonitor,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.DELETE_PERFORMANCE_MONITOR_RESET:
            return {
                ...state,
                deletePerformanceMonitor: {
                    ...INITIAL_STATE.deletePerformanceMonitor,
                },
            };

        case types.RESET_PERFORMANCE_MONITOR_KEY_REQUEST:
            return {
                ...state,
                resetPerformanceMonitorKey: {
                    ...state.resetPerformanceMonitorKey,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.RESET_PERFORMANCE_MONITOR_KEY_SUCCESS:
            return {
                ...state,
                resetPerformanceMonitorKey: {
                    requesting: false,
                    success: true,
                    error: null,
                    performanceMonitor: action.payload,
                },
            };

        case types.RESET_PERFORMANCE_MONITOR_KEY_FAILURE:
            return {
                ...state,
                resetPerformanceMonitorKey: {
                    ...state.resetPerformanceMonitorKey,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.RESET_PERFORMANCE_MONITOR_KEY_RESET:
            return {
                ...state,
                resetPerformanceMonitorKey: {
                    ...INITIAL_STATE.resetPerformanceMonitorKey,
                },
            };

        default:
            return state;
    }
}
