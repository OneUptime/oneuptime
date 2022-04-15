import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/performanceTrackerMetric';
import moment from 'moment';
import { encode } from 'js-base64';
import ErrorPayload from 'CommonUI/src/payload-types/error';
// fetch performance tracker metrics - TIME
export const fetchTimeMetricsRequest: Function = (): void => {
    return {
        type: types.FETCH_TIME_METRICS_REQUEST,
    };
};

export const fetchTimeMetricsSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_TIME_METRICS_SUCCESS,
        payload,
    };
};

export const fetchTimeMetricsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_TIME_METRICS_FAILURE,
        payload: error,
    };
};

export const fetchTimeMetrics: $TSFixMe = ({
    appId,
    key,
    startDate,
    endDate,
}: $TSFixMe) => {
    return (dispatch: Dispatch) => {
        dispatch(fetchTimeMetricsRequest());

        startDate = encode(moment(startDate).format());
        endDate = encode(moment(endDate).format());

        const promise: $TSFixMe = BackendAPI.get(
            `performanceMetric/${appId}/key/${key}/time?startDate=${startDate}&endDate=${endDate}`
        );

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(fetchTimeMetricsSuccess(response.data));
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
                dispatch(fetchTimeMetricsFailure(errorMsg));
            }
        );

        return promise;
    };
};

// fetch performance tracker metrics - THROUGHPUT
export const fetchThroughputMetricsRequest: Function = (): void => {
    return {
        type: types.FETCH_THROUGHPUT_METRICS_REQUEST,
    };
};

export const fetchThroughputMetricsSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.FETCH_THROUGHPUT_METRICS_SUCCESS,
        payload,
    };
};

export const fetchThroughputMetricsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_THROUGHPUT_METRICS_FAILURE,
        payload: error,
    };
};

export const fetchThroughputMetrics: $TSFixMe = ({
    appId,
    key,
    startDate,
    endDate,
}: $TSFixMe) => {
    return (dispatch: Dispatch) => {
        dispatch(fetchThroughputMetricsRequest());

        startDate = encode(moment(startDate).format());
        endDate = encode(moment(endDate).format());

        const promise: $TSFixMe = BackendAPI.get(
            `performanceMetric/${appId}/key/${key}/throughput?startDate=${startDate}&endDate=${endDate}`
        );

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(fetchThroughputMetricsSuccess(response.data));
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
                dispatch(fetchThroughputMetricsFailure(errorMsg));
            }
        );

        return promise;
    };
};

// fetch performance tracker metrics - ERROR
export const fetchErrorMetricsRequest: Function = (): void => {
    return {
        type: types.FETCH_ERROR_METRICS_REQUEST,
    };
};

export const fetchErrorMetricsSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_ERROR_METRICS_SUCCESS,
        payload,
    };
};

export const fetchErrorMetricsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_ERROR_METRICS_FAILURE,
        payload: error,
    };
};

export const fetchErrorMetrics: $TSFixMe = ({
    appId,
    key,
    startDate,
    endDate,
}: $TSFixMe) => {
    return (dispatch: Dispatch) => {
        dispatch(fetchErrorMetricsRequest());

        startDate = encode(moment(startDate).format());
        endDate = encode(moment(endDate).format());

        const promise: $TSFixMe = BackendAPI.get(
            `performanceMetric/${appId}/key/${key}/error?startDate=${startDate}&endDate=${endDate}`
        );

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(fetchErrorMetricsSuccess(response.data));
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
                dispatch(fetchErrorMetricsFailure(errorMsg));
            }
        );

        return promise;
    };
};

// handle setting startDate/endDate - (TIME || THROUGHPUT || ERROR)
export const setTimeStartDate: Function = (date: $TSFixMe): void => {
    return {
        type: types.SET_TIME_STARTDATE,
        payload: date,
    };
};

export const setTimeEndDate: Function = (date: $TSFixMe): void => {
    return {
        type: types.SET_TIME_ENDDATE,
        payload: date,
    };
};

export const setThroughputStartDate: Function = (date: $TSFixMe): void => {
    return {
        type: types.SET_THROUGHPUT_STARTDATE,
        payload: date,
    };
};

export const setThroughputEndDate: Function = (date: $TSFixMe): void => {
    return {
        type: types.SET_THROUGHPUT_ENDDATE,
        payload: date,
    };
};

export const setErrorStartDate: Function = (date: $TSFixMe): void => {
    return {
        type: types.SET_ERROR_STARTDATE,
        payload: date,
    };
};

export const setErrorEndDate: Function = (date: $TSFixMe): void => {
    return {
        type: types.SET_ERROR_ENDDATE,
        payload: date,
    };
};

export const resetTimeDate: Function = (startDate: $TSFixMe, endDate: $TSFixMe): void => {
    return {
        type: types.RESET_TIME_DATE,
        payload: { startDate, endDate },
    };
};

export const resetThroughputDate: Function = (startDate: $TSFixMe, endDate: $TSFixMe): void => {
    return {
        type: types.RESET_THROUGHPUT_DATE,
        payload: { startDate, endDate },
    };
};

export const resetErrorDate: Function = (startDate: $TSFixMe, endDate: $TSFixMe): void => {
    return {
        type: types.RESET_ERROR_DATE,
        payload: { startDate, endDate },
    };
};

export const resetIncomingDate: Function = (startDate: $TSFixMe, endDate: $TSFixMe): void => {
    return {
        type: types.RESET_INCOMING_DATE,
        payload: { startDate, endDate },
    };
};

export const resetOutgoingDate: Function = (startDate: $TSFixMe, endDate: $TSFixMe): void => {
    return {
        type: types.RESET_OUTGOING_DATE,
        payload: { startDate, endDate },
    };
};

// update metrics from realtime update
export const updateTimeMetrics: Function = (payload: $TSFixMe): void => {
    return {
        type: types.UPDATE_TIME_METRICS,
        payload,
    };
};

export const updateThroughputMetrics: Function = (payload: $TSFixMe): void => {
    return {
        type: types.UPDATE_THROUGHPUT_METRICS,
        payload,
    };
};

export const updateErrorMetrics: Function = (payload: $TSFixMe): void => {
    return {
        type: types.UPDATE_ERROR_METRICS,
        payload,
    };
};

// fetch all performance metrics (incoming/outgoing)
export const fetchIncomingMetricsRequest: Function = (): void => {
    return {
        type: types.FETCH_INCOMING_METRICS_REQUEST,
    };
};

export const fetchIncomingMetricsSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.FETCH_INCOMING_METRICS_SUCCESS,
        payload,
    };
};

export const fetchIncomingMetricsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_INCOMING_METRICS_FAILURE,
        payload: error,
    };
};

export const fetchIncomingMetrics: $TSFixMe = ({
    appId,
    key,
    skip,
    limit,
    startDate,
    endDate,
}: $TSFixMe) => {
    return (dispatch: Dispatch) => {
        dispatch(fetchIncomingMetricsRequest());

        startDate = encode(moment(startDate).format());
        endDate = encode(moment(endDate).format());

        const promise: $TSFixMe = BackendAPI.get(
            `performanceMetric/${appId}/key/${key}?type=incoming&skip=${skip}&limit=${limit}&startDate=${startDate}&endDate=${endDate}`
        );

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(fetchIncomingMetricsSuccess(response.data));
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
                dispatch(fetchIncomingMetricsFailure(errorMsg));
            }
        );

        return promise;
    };
};

export const fetchOutgoingMetricsRequest: Function = (): void => {
    return {
        type: types.FETCH_OUTGOING_METRICS_REQUEST,
    };
};

export const fetchOutgoingMetricsSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.FETCH_OUTGOING_METRICS_SUCCESS,
        payload,
    };
};

export const fetchOutgoingMetricsFailing: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_OUTGOING_METRICS_FAILURE,
        payload: error,
    };
};

export const fetchOutgoingMetrics: $TSFixMe = ({
    appId,
    key,
    skip,
    limit,
    startDate,
    endDate,
}: $TSFixMe) => {
    return (dispatch: Dispatch) => {
        dispatch(fetchOutgoingMetricsRequest());

        startDate = encode(moment(startDate).format());
        endDate = encode(moment(endDate).format());

        const promise: $TSFixMe = BackendAPI.get(
            `performanceMetric/${appId}/key/${key}?type=outgoing&skip=${skip}&limit=${limit}&startDate=${startDate}&endDate=${endDate}`
        );

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(fetchOutgoingMetricsSuccess(response.data));
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
                dispatch(fetchOutgoingMetricsFailing(errorMsg));
            }
        );

        return promise;
    };
};

export const setIncomingStartDate: Function = (payload: $TSFixMe): void => {
    return {
        type: types.SET_INCOMING_STARTDATE,
        payload,
    };
};

export const setIncomingEndDate: Function = (payload: $TSFixMe): void => {
    return {
        type: types.SET_INCOMING_ENDDATE,
        payload,
    };
};

export const setOutgoingStartDate: Function = (payload: $TSFixMe): void => {
    return {
        type: types.SET_OUTGOING_STARTDATE,
        payload,
    };
};

export const setOutgoingEndDate: Function = (payload: $TSFixMe): void => {
    return {
        type: types.SET_OUTGOING_ENDDATE,
        payload,
    };
};

// delete a particular performance metrics (incoming/outgoing)
export const deleteIncomingMetricsRequest: Function = (): void => {
    return {
        type: types.DELETE_INCOMING_METRICS_REQUEST,
    };
};

export const deleteIncomingMetricsSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.DELETE_INCOMING_METRICS_SUCCESS,
        payload,
    };
};

export const deleteIncomingMetricsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.DELETE_INCOMING_METRICS_FAILURE,
        payload: error,
    };
};

export const resetIncomingDelete: Function = (): void => {
    return {
        type: types.RESET_INCOMING_DELETE,
    };
};

export const deleteIncomingMetrics: $TSFixMe = ({
    appId,
    key,
    metricId,
}: $TSFixMe) => {
    return (dispatch: Dispatch) => {
        dispatch(deleteIncomingMetricsRequest());

        const promise: $TSFixMe =
            delete `performanceMetric/${appId}/key/${key}/${metricId}`;

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(deleteIncomingMetricsSuccess(response.data));
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
                dispatch(deleteIncomingMetricsFailure(errorMsg));
            }
        );

        return promise;
    };
};

export const deleteOutgoingMetricsRequest: Function = (): void => {
    return {
        type: types.DELETE_OUTGOING_METRICS_REQUEST,
    };
};

export const deleteOutgoingMetricsSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.DELETE_OUTGOING_METRICS_SUCCESS,
        payload,
    };
};

export const deleteOutgoingMetricsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.DELETE_OUTGOING_METRICS_FAILURE,
        payload: error,
    };
};

export const resetOutgoingDelete: Function = (): void => {
    return {
        type: types.RESET_OUTGOING_DELETE,
    };
};

export const deleteOutgoingMetrics: $TSFixMe = ({
    appId,
    key,
    metricId,
}: $TSFixMe) => {
    return (dispatch: Dispatch) => {
        dispatch(deleteOutgoingMetricsRequest());

        const promise: $TSFixMe =
            delete `performanceMetric/${appId}/key/${key}/${metricId}`;

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(deleteOutgoingMetricsSuccess(response.data));
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
                dispatch(deleteOutgoingMetricsFailure(errorMsg));
            }
        );

        return promise;
    };
};
