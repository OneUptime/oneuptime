import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/performanceMonitor';

// create performance monitor
export const createPerformanceMonitorRequest = () => ({
    type: types.CREATE_PERFORMANCE_MONITOR_REQUEST,
});

export const createPerformanceMonitorSuccess = payload => ({
    type: types.CREATE_PERFORMANCE_MONITOR_SUCCESS,
    payload,
});

export const createPerformanceMonitorFailure = error => ({
    type: types.CREATE_PERFORMANCE_MONITOR_FAILURE,
    payload: error,
});

export const createPerformanceMonitorReset = () => ({
    type: types.CREATE_PERFORMANCE_MONITOR_RESET,
});

export const createPerformanceMonitor = ({
    projectId,
    componentId,
    values,
}) => dispatch => {
    dispatch(createPerformanceMonitorRequest());
    const promise = postApi(
        `performanceMonitor/${projectId}/${componentId}/create`,
        values
    );

    promise.then(
        function(response) {
            dispatch(createPerformanceMonitorSuccess(response.data));
        },
        function(error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(createPerformanceMonitorFailure(errorMsg));
        }
    );

    return promise;
};

// fetch a single performance monitor
export const fetchPerformanceMonitorRequest = () => ({
    type: types.FETCH_PERFORMANCE_MONITOR_REQUEST,
});

export const fetchPerformanceMonitorSuccess = payload => ({
    type: types.FETCH_PERFORMANCE_MONITOR_SUCCESS,
    payload,
});

export const fetchPerformanceMonitorFailure = error => ({
    type: types.FETCH_PERFORMANCE_MONITOR_FAILURE,
    payload: error,
});

export const fetchPerformanceMonitorReset = () => ({
    type: types.FETCH_PERFORMANCE_MONITOR_RESET,
});

export const fetchPerformanceMonitor = ({
    projectId,
    performanceMonitorId,
    slug,
}) => dispatch => {
    dispatch(fetchPerformanceMonitorRequest());
    const promise = getApi(
        `performanceMonitor/${projectId}/monitor/${performanceMonitorId}?slug=${slug}`
    );

    promise.then(
        function(response) {
            dispatch(fetchPerformanceMonitorSuccess(response.data));
        },
        function(error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(fetchPerformanceMonitorFailure(errorMsg));
        }
    );

    return promise;
};

// fetch performance monitor list
export const fetchPerformanceMonitorsRequest = () => ({
    type: types.FETCH_PERFORMANCE_MONITORS_REQUEST,
});

export const fetchPerformanceMonitorsSuccess = payload => ({
    type: types.FETCH_PERFORMANCE_MONITORS_SUCCESS,
    payload,
});

export const fetchPerformanceMonitorsFailure = error => ({
    type: types.FETCH_PERFORMANCE_MONITORS_FAILURE,
    payload: error,
});

export const fetchPerformanceMonitorsReset = () => ({
    type: types.FETCH_PERFORMANCE_MONITORS_RESET,
});

export const fetchPerformanceMonitors = ({
    projectId,
    componentId,
    skip,
    limit,
}) => dispatch => {
    dispatch(fetchPerformanceMonitorsRequest());
    const promise = getApi(
        `performanceMonitor/${projectId}/${componentId}?skip=${skip}&limit=${limit}`
    );

    promise.then(
        function(response) {
            dispatch(fetchPerformanceMonitorsSuccess(response.data));
        },
        function(error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(fetchPerformanceMonitorsFailure(errorMsg));
        }
    );

    return promise;
};

// update performance monitor
export const updatePerformanceMonitorRequest = () => ({
    type: types.UPDATE_PERFORMANCE_MONITOR_REQUEST,
});

export const updatePerformanceMonitorSuccess = payload => ({
    type: types.UPDATE_PERFORMANCE_MONITOR_SUCCESS,
    payload,
});

export const updatePerformanceMonitorFailure = error => ({
    type: types.UPDATE_PERFORMANCE_MONITOR_FAILURE,
    payload: error,
});

export const updatePerformanceMonitorReset = () => ({
    type: types.UPDATE_PERFORMANCE_MONITOR_RESET,
});

export const updatePerformanceMonitor = ({
    projectId,
    componentId,
    performanceMonitorId,
    values,
}) => dispatch => {
    dispatch(updatePerformanceMonitorRequest());
    const promise = putApi(
        `performanceMonitor/${projectId}/${componentId}/${performanceMonitorId}`,
        values
    );

    promise.then(
        function(response) {
            dispatch(updatePerformanceMonitorSuccess(response.data));
        },
        function(error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(updatePerformanceMonitorFailure(errorMsg));
        }
    );

    return promise;
};

// delete performance monitor
export const deletePerformanceMonitorRequest = () => ({
    type: types.DELETE_PERFORMANCE_MONITOR_REQUEST,
});

export const deletePerformanceMonitorSuccess = payload => ({
    type: types.DELETE_PERFORMANCE_MONITOR_SUCCESS,
    payload,
});

export const deletePerformanceMonitorFailure = error => ({
    type: types.DELETE_PERFORMANCE_MONITOR_FAILURE,
    payload: error,
});

export const deletePerformanceMonitorReset = () => ({
    type: types.DELETE_PERFORMANCE_MONITOR_RESET,
});

export const deletePerformanceMonitor = ({
    projectId,
    performanceMonitorId,
}) => dispatch => {
    dispatch(deletePerformanceMonitorRequest());
    const promise = deleteApi(
        `performanceMonitor/${projectId}/monitor/${performanceMonitorId}`
    );

    promise.then(
        function(response) {
            dispatch(deletePerformanceMonitorSuccess(response.data));
        },
        function(error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(deletePerformanceMonitorFailure(errorMsg));
        }
    );

    return promise;
};

// reset performance monitor api key
export const resetPerformanceMonitorKeyRequest = () => ({
    type: types.RESET_PERFORMANCE_MONITOR_KEY_REQUEST,
});

export const resetPerformanceMonitorKeySuccess = payload => ({
    type: types.RESET_PERFORMANCE_MONITOR_KEY_SUCCESS,
    payload,
});

export const resetPerformanceMonitorKeyFailure = error => ({
    type: types.RESET_PERFORMANCE_MONITOR_KEY_FAILURE,
    payload: error,
});

export const resetPerformanceMonitorKeyReset = () => ({
    type: types.RESET_PERFORMANCE_MONITOR_KEY_RESET,
});

export const resetPerformanceMonitorKey = ({
    projectId,
    performanceMonitorId,
}) => dispatch => {
    dispatch(resetPerformanceMonitorKeyRequest());
    const promise = putApi(
        `performanceMonitor/${projectId}/reset-key/${performanceMonitorId}`,
        {}
    );

    promise.then(
        function(response) {
            dispatch(resetPerformanceMonitorKeySuccess(response.data));
        },
        function(error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(resetPerformanceMonitorKeyFailure(errorMsg));
        }
    );

    return promise;
};
