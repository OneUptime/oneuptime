import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/performanceTracker';
import { encode } from 'js-base64';
import ErrorPayload from 'CommonUI/src/payload-types/error';
export const setStartDate: Function = (date: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'SET_START_DATE',
            payload: date,
        });
    };
};

export const setEndDate: Function = (date: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'SET_END_DATE',
            payload: date,
        });
    };
};

// create performance tracker
export const createPerformanceTrackerRequest: Function = (): void => {
    return {
        type: types.CREATE_PERFORMANCE_TRACKER_REQUEST,
    };
};

export const createPerformanceTrackerSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.CREATE_PERFORMANCE_TRACKER_SUCCESS,
        payload,
    };
};

export const createPerformanceTrackerFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.CREATE_PERFORMANCE_TRACKER_FAILURE,
        payload: error,
    };
};

export const createPerformanceTrackerReset: Function = (): void => {
    return {
        type: types.CREATE_PERFORMANCE_TRACKER_RESET,
    };
};

export const createPerformanceTracker: $TSFixMe = ({
    projectId,
    componentId,
    values,
}: $TSFixMe) => {
    return (dispatch: Dispatch) => {
        dispatch(createPerformanceTrackerRequest());
        const promise: $TSFixMe = BackendAPI.post(
            `performanceTracker/${projectId}/${componentId}/create`,
            values
        );

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(createPerformanceTrackerSuccess(response.data));
            },
            (error: $TSFixMe): void => {
                const errorMsg: $TSFixMe =
                    error.response && error.response.data
                        ? error.response.data
                        : error.data
                        ? error.data
                        : error.message
                        ? error.message
                        : 'Network Error';
                dispatch(createPerformanceTrackerFailure(errorMsg));
            }
        );

        return promise;
    };
};

// fetch a single performance tracker
export const fetchPerformanceTrackerRequest: Function = (): void => {
    return {
        type: types.FETCH_PERFORMANCE_TRACKER_REQUEST,
    };
};

export const fetchPerformanceTrackerSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.FETCH_PERFORMANCE_TRACKER_SUCCESS,
        payload,
    };
};

export const fetchPerformanceTrackerFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_PERFORMANCE_TRACKER_FAILURE,
        payload: error,
    };
};

export const fetchPerformanceTrackerReset: Function = (): void => {
    return {
        type: types.FETCH_PERFORMANCE_TRACKER_RESET,
    };
};

export const fetchPerformanceTracker: $TSFixMe = ({
    projectId,
    performanceTrackerId,
    slug,
}: $TSFixMe) => {
    return (dispatch: Dispatch) => {
        dispatch(fetchPerformanceTrackerRequest());
        const promise: $TSFixMe = BackendAPI.get(
            `performanceTracker/${projectId}/tracker/${performanceTrackerId}?slug=${slug}`
        );

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(fetchPerformanceTrackerSuccess(response.data));
            },
            (error: $TSFixMe): void => {
                const errorMsg: $TSFixMe =
                    error.response && error.response.data
                        ? error.response.data
                        : error.data
                        ? error.data
                        : error.message
                        ? error.message
                        : 'Network Error';
                dispatch(fetchPerformanceTrackerFailure(errorMsg));
            }
        );

        return promise;
    };
};

// fetch performance tracker list
export const fetchPerformanceTrackersRequest: Function = (
    fetchingPage: $TSFixMe
): void => {
    return {
        type: types.FETCH_PERFORMANCE_TRACKERS_REQUEST,
        payload: fetchingPage,
    };
};

export const fetchPerformanceTrackersSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.FETCH_PERFORMANCE_TRACKERS_SUCCESS,
        payload,
    };
};

export const fetchPerformanceTrackersFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_PERFORMANCE_TRACKERS_FAILURE,
        payload: error,
    };
};

export const fetchPerformanceTrackersReset: Function = (): void => {
    return {
        type: types.FETCH_PERFORMANCE_TRACKERS_RESET,
    };
};

export const fetchPerformanceTrackers: $TSFixMe = ({
    projectId,
    componentId,
    skip = 0,
    limit = 0,
    fetchingPage = false,
}: $TSFixMe) => {
    return (dispatch: Dispatch) => {
        dispatch(fetchPerformanceTrackersRequest(fetchingPage));
        const promise: $TSFixMe = BackendAPI.get(
            `performanceTracker/${projectId}/${componentId}?skip=${skip}&limit=${limit}`
        );

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(fetchPerformanceTrackersSuccess(response.data));
            },
            (error: $TSFixMe): void => {
                const errorMsg: $TSFixMe =
                    error.response && error.response.data
                        ? error.response.data
                        : error.data
                        ? error.data
                        : error.message
                        ? error.message
                        : 'Network Error';
                dispatch(fetchPerformanceTrackersFailure(errorMsg));
            }
        );

        return promise;
    };
};

// update performance tracker
export const updatePerformanceTrackerRequest: Function = (): void => {
    return {
        type: types.UPDATE_PERFORMANCE_TRACKER_REQUEST,
    };
};

export const updatePerformanceTrackerSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.UPDATE_PERFORMANCE_TRACKER_SUCCESS,
        payload,
    };
};

export const updatePerformanceTrackerFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_PERFORMANCE_TRACKER_FAILURE,
        payload: error,
    };
};

export const updatePerformanceTrackerReset: Function = (): void => {
    return {
        type: types.UPDATE_PERFORMANCE_TRACKER_RESET,
    };
};

export const updatePerformanceTracker: $TSFixMe = ({
    projectId,
    componentId,
    performanceTrackerId,
    values,
}: $TSFixMe) => {
    return (dispatch: Dispatch) => {
        dispatch(updatePerformanceTrackerRequest());
        const promise: $TSFixMe = BackendAPI.put(
            `performanceTracker/${projectId}/${componentId}/update-tracker/${performanceTrackerId}`,
            values
        );

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(updatePerformanceTrackerSuccess(response.data));
            },
            (error: $TSFixMe): void => {
                const errorMsg: $TSFixMe =
                    error.response && error.response.data
                        ? error.response.data
                        : error.data
                        ? error.data
                        : error.message
                        ? error.message
                        : 'Network Error';
                dispatch(updatePerformanceTrackerFailure(errorMsg));
            }
        );

        return promise;
    };
};

// delete performance tracker
export const deletePerformanceTrackerRequest: Function = (): void => {
    return {
        type: types.DELETE_PERFORMANCE_TRACKER_REQUEST,
    };
};

export const deletePerformanceTrackerSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.DELETE_PERFORMANCE_TRACKER_SUCCESS,
        payload,
    };
};

export const deletePerformanceTrackerFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.DELETE_PERFORMANCE_TRACKER_FAILURE,
        payload: error,
    };
};

export const deletePerformanceTrackerReset: Function = (): void => {
    return {
        type: types.DELETE_PERFORMANCE_TRACKER_RESET,
    };
};

export const deletePerformanceTracker: $TSFixMe = ({
    projectId,
    performanceTrackerId,
}: $TSFixMe) => {
    return (dispatch: Dispatch) => {
        dispatch(deletePerformanceTrackerRequest());

        const promise: $TSFixMe =
            delete `performanceTracker/${projectId}/tracker/${performanceTrackerId}`;

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(deletePerformanceTrackerSuccess(response.data));
            },
            (error: $TSFixMe): void => {
                const errorMsg: $TSFixMe =
                    error.response && error.response.data
                        ? error.response.data
                        : error.data
                        ? error.data
                        : error.message
                        ? error.message
                        : 'Network Error';
                dispatch(deletePerformanceTrackerFailure(errorMsg));
            }
        );

        return promise;
    };
};

// reset performance tracker api key
export const resetPerformanceTrackerKeyRequest: Function = (): void => {
    return {
        type: types.RESET_PERFORMANCE_TRACKER_KEY_REQUEST,
    };
};

export const resetPerformanceTrackerKeySuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.RESET_PERFORMANCE_TRACKER_KEY_SUCCESS,
        payload,
    };
};

export const resetPerformanceTrackerKeyFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.RESET_PERFORMANCE_TRACKER_KEY_FAILURE,
        payload: error,
    };
};

export const resetPerformanceTrackerKeyReset: Function = (): void => {
    return {
        type: types.RESET_PERFORMANCE_TRACKER_KEY_RESET,
    };
};

export const resetPerformanceTrackerKey: $TSFixMe = ({
    projectId,
    performanceTrackerId,
}: $TSFixMe) => {
    return (dispatch: Dispatch) => {
        dispatch(resetPerformanceTrackerKeyRequest());
        const promise: $TSFixMe = BackendAPI.put(
            `performanceTracker/${projectId}/reset-key/${performanceTrackerId}`,
            {}
        );

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(resetPerformanceTrackerKeySuccess(response.data));
            },
            (error: $TSFixMe): void => {
                const errorMsg: $TSFixMe =
                    error.response && error.response.data
                        ? error.response.data
                        : error.data
                        ? error.data
                        : error.message
                        ? error.message
                        : 'Network Error';
                dispatch(resetPerformanceTrackerKeyFailure(errorMsg));
            }
        );

        return promise;
    };
};

// remove quickstart guide
export const removeQuickStartRequest: Function = (): void => {
    return {
        type: types.REMOVE_QUICK_START_REQUEST,
    };
};

export const removeQuickStartSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.REMOVE_QUICK_START_SUCCESS,
        payload,
    };
};

export const removeQuickStartFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.REMOVE_QUICK_START_FAILURE,
        payload: error,
    };
};

export const removeQuickStart: $TSFixMe = ({
    projectId,
    performanceTrackerId,
}: $TSFixMe) => {
    return (dispatch: Dispatch) => {
        dispatch(removeQuickStartRequest());
        const promise: $TSFixMe = BackendAPI.put(
            `performanceTracker/${projectId}/remove-quickstart/${performanceTrackerId}`,
            {}
        );

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(removeQuickStartSuccess(response.data));
            },
            (error: $TSFixMe): void => {
                const errorMsg: $TSFixMe =
                    error.response && error.response.data
                        ? error.response.data
                        : error.data
                        ? error.data
                        : error.message
                        ? error.message
                        : 'Network Error';
                dispatch(removeQuickStartFailure(errorMsg));
            }
        );

        return promise;
    };
};

// fetch last metrics
export const fetchLastMetricsRequest: Function = (): void => {
    return {
        type: types.FETCH_LAST_METRICS_REQUEST,
    };
};

export const fetchLastMetricsSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_LAST_METRICS_SUCCESS,
        payload,
    };
};

export const fetchLastMetricsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_LAST_METRICS_FAILURE,
        payload: error,
    };
};

export const fetchLastMetrics: $TSFixMe = ({
    projectId,
    performanceTrackerId,
    startDate,
    endDate,
}: $TSFixMe) => {
    return (dispatch: Dispatch) => {
        dispatch(fetchLastMetricsRequest());

        startDate = encode(startDate);
        endDate = encode(endDate);

        const promise: $TSFixMe = BackendAPI.get(
            `performanceTracker/${projectId}/last-metrics/${performanceTrackerId}?startDate=${startDate}&endDate=${endDate}`
        );

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(fetchLastMetricsSuccess(response.data));
            },
            (error: $TSFixMe): void => {
                const errorMsg: $TSFixMe =
                    error.response && error.response.data
                        ? error.response.data
                        : error.data
                        ? error.data
                        : error.message
                        ? error.message
                        : 'Network Error';
                dispatch(fetchLastMetricsFailure(errorMsg));
            }
        );

        return promise;
    };
};

export const addPerformanceTracker: $TSFixMe = (payload: $TSFixMe) => {
    return (dispatch: Dispatch) => {
        return dispatch({
            type: types.ADD_PERFORMANCE_TRACKER,
            payload,
        });
    };
};
