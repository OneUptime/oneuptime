import { getApi, deleteApi } from '../api';
import * as types from '../constants/performanceTrackerMetric';
import moment from 'moment';
import { encode } from 'js-base64';

// fetch performance tracker metrics - TIME
export const fetchTimeMetricsRequest = () => ({
    type: types.FETCH_TIME_METRICS_REQUEST,
});

export const fetchTimeMetricsSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_TIME_METRICS_SUCCESS,
    payload,
});

export const fetchTimeMetricsFailure = (error: $TSFixMe) => ({
    type: types.FETCH_TIME_METRICS_FAILURE,
    payload: error,
});

export const fetchTimeMetrics = ({
    appId,
    key,
    startDate,
    endDate,
}: $TSFixMe) => (dispatch: $TSFixMe) => {
    dispatch(fetchTimeMetricsRequest());

    startDate = encode(moment(startDate).format());
    endDate = encode(moment(endDate).format());

    const promise = getApi(
        `performanceMetric/${appId}/key/${key}/time?startDate=${startDate}&endDate=${endDate}`
    );

    promise.then(
        function(response) {
            dispatch(fetchTimeMetricsSuccess(response.data));
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
            dispatch(fetchTimeMetricsFailure(errorMsg));
        }
    );

    return promise;
};

// fetch performance tracker metrics - THROUGHPUT
export const fetchThroughputMetricsRequest = () => ({
    type: types.FETCH_THROUGHPUT_METRICS_REQUEST,
});

export const fetchThroughputMetricsSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_THROUGHPUT_METRICS_SUCCESS,
    payload,
});

export const fetchThroughputMetricsFailure = (error: $TSFixMe) => ({
    type: types.FETCH_THROUGHPUT_METRICS_FAILURE,
    payload: error,
});

export const fetchThroughputMetrics = ({
    appId,
    key,
    startDate,
    endDate,
}: $TSFixMe) => (dispatch: $TSFixMe) => {
    dispatch(fetchThroughputMetricsRequest());

    startDate = encode(moment(startDate).format());
    endDate = encode(moment(endDate).format());

    const promise = getApi(
        `performanceMetric/${appId}/key/${key}/throughput?startDate=${startDate}&endDate=${endDate}`
    );

    promise.then(
        function(response) {
            dispatch(fetchThroughputMetricsSuccess(response.data));
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
            dispatch(fetchThroughputMetricsFailure(errorMsg));
        }
    );

    return promise;
};

// fetch performance tracker metrics - ERROR
export const fetchErrorMetricsRequest = () => ({
    type: types.FETCH_ERROR_METRICS_REQUEST,
});

export const fetchErrorMetricsSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_ERROR_METRICS_SUCCESS,
    payload,
});

export const fetchErrorMetricsFailure = (error: $TSFixMe) => ({
    type: types.FETCH_ERROR_METRICS_FAILURE,
    payload: error,
});

export const fetchErrorMetrics = ({
    appId,
    key,
    startDate,
    endDate,
}: $TSFixMe) => (dispatch: $TSFixMe) => {
    dispatch(fetchErrorMetricsRequest());

    startDate = encode(moment(startDate).format());
    endDate = encode(moment(endDate).format());

    const promise = getApi(
        `performanceMetric/${appId}/key/${key}/error?startDate=${startDate}&endDate=${endDate}`
    );

    promise.then(
        function(response) {
            dispatch(fetchErrorMetricsSuccess(response.data));
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
            dispatch(fetchErrorMetricsFailure(errorMsg));
        }
    );

    return promise;
};

// handle setting startDate/endDate - (TIME || THROUGHPUT || ERROR)
export const setTimeStartDate = (date: $TSFixMe) => ({
    type: types.SET_TIME_STARTDATE,
    payload: date,
});

export const setTimeEndDate = (date: $TSFixMe) => ({
    type: types.SET_TIME_ENDDATE,
    payload: date,
});

export const setThroughputStartDate = (date: $TSFixMe) => ({
    type: types.SET_THROUGHPUT_STARTDATE,
    payload: date,
});

export const setThroughputEndDate = (date: $TSFixMe) => ({
    type: types.SET_THROUGHPUT_ENDDATE,
    payload: date,
});

export const setErrorStartDate = (date: $TSFixMe) => ({
    type: types.SET_ERROR_STARTDATE,
    payload: date,
});

export const setErrorEndDate = (date: $TSFixMe) => ({
    type: types.SET_ERROR_ENDDATE,
    payload: date,
});

export const resetTimeDate = (startDate, endDate) => ({
    type: types.RESET_TIME_DATE,
    payload: { startDate, endDate },
});

export const resetThroughputDate = (startDate, endDate) => ({
    type: types.RESET_THROUGHPUT_DATE,
    payload: { startDate, endDate },
});

export const resetErrorDate = (startDate, endDate) => ({
    type: types.RESET_ERROR_DATE,
    payload: { startDate, endDate },
});

export const resetIncomingDate = (startDate, endDate) => ({
    type: types.RESET_INCOMING_DATE,
    payload: { startDate, endDate },
});

export const resetOutgoingDate = (startDate, endDate) => ({
    type: types.RESET_OUTGOING_DATE,
    payload: { startDate, endDate },
});

// update metrics from realtime update
export const updateTimeMetrics = (payload: $TSFixMe) => ({
    type: types.UPDATE_TIME_METRICS,
    payload,
});

export const updateThroughputMetrics = (payload: $TSFixMe) => ({
    type: types.UPDATE_THROUGHPUT_METRICS,
    payload,
});

export const updateErrorMetrics = (payload: $TSFixMe) => ({
    type: types.UPDATE_ERROR_METRICS,
    payload,
});

// fetch all performance metrics (incoming/outgoing)
export const fetchIncomingMetricsRequest = () => ({
    type: types.FETCH_INCOMING_METRICS_REQUEST,
});

export const fetchIncomingMetricsSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_INCOMING_METRICS_SUCCESS,
    payload,
});

export const fetchIncomingMetricsFailure = (error: $TSFixMe) => ({
    type: types.FETCH_INCOMING_METRICS_FAILURE,
    payload: error,
});

export const fetchIncomingMetrics = ({
    appId,
    key,
    skip,
    limit,
    startDate,
    endDate,
}: $TSFixMe) => (dispatch: $TSFixMe) => {
    dispatch(fetchIncomingMetricsRequest());

    startDate = encode(moment(startDate).format());
    endDate = encode(moment(endDate).format());

    const promise = getApi(
        `performanceMetric/${appId}/key/${key}?type=incoming&skip=${skip}&limit=${limit}&startDate=${startDate}&endDate=${endDate}`
    );

    promise.then(
        function(response) {
            dispatch(fetchIncomingMetricsSuccess(response.data));
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
            dispatch(fetchIncomingMetricsFailure(errorMsg));
        }
    );

    return promise;
};

export const fetchOutgoingMetricsRequest = () => ({
    type: types.FETCH_OUTGOING_METRICS_REQUEST,
});

export const fetchOutgoingMetricsSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_OUTGOING_METRICS_SUCCESS,
    payload,
});

export const fetchOutgoingMetricsFailing = (error: $TSFixMe) => ({
    type: types.FETCH_OUTGOING_METRICS_FAILURE,
    payload: error,
});

export const fetchOutgoingMetrics = ({
    appId,
    key,
    skip,
    limit,
    startDate,
    endDate,
}: $TSFixMe) => (dispatch: $TSFixMe) => {
    dispatch(fetchOutgoingMetricsRequest());

    startDate = encode(moment(startDate).format());
    endDate = encode(moment(endDate).format());

    const promise = getApi(
        `performanceMetric/${appId}/key/${key}?type=outgoing&skip=${skip}&limit=${limit}&startDate=${startDate}&endDate=${endDate}`
    );

    promise.then(
        function(response) {
            dispatch(fetchOutgoingMetricsSuccess(response.data));
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
            dispatch(fetchOutgoingMetricsFailing(errorMsg));
        }
    );

    return promise;
};

export const setIncomingStartDate = (payload: $TSFixMe) => ({
    type: types.SET_INCOMING_STARTDATE,
    payload,
});

export const setIncomingEndDate = (payload: $TSFixMe) => ({
    type: types.SET_INCOMING_ENDDATE,
    payload,
});

export const setOutgoingStartDate = (payload: $TSFixMe) => ({
    type: types.SET_OUTGOING_STARTDATE,
    payload,
});

export const setOutgoingEndDate = (payload: $TSFixMe) => ({
    type: types.SET_OUTGOING_ENDDATE,
    payload,
});

// delete a particular performance metrics (incoming/outgoing)
export const deleteIncomingMetricsRequest = () => ({
    type: types.DELETE_INCOMING_METRICS_REQUEST,
});

export const deleteIncomingMetricsSuccess = (payload: $TSFixMe) => ({
    type: types.DELETE_INCOMING_METRICS_SUCCESS,
    payload,
});

export const deleteIncomingMetricsFailure = (error: $TSFixMe) => ({
    type: types.DELETE_INCOMING_METRICS_FAILURE,
    payload: error,
});

export const resetIncomingDelete = () => ({
    type: types.RESET_INCOMING_DELETE,
});

export const deleteIncomingMetrics = ({ appId, key, metricId }: $TSFixMe) => (
    dispatch: $TSFixMe
) => {
    dispatch(deleteIncomingMetricsRequest());

    const promise = deleteApi(
        `performanceMetric/${appId}/key/${key}/${metricId}`
    );

    promise.then(
        function(response) {
            dispatch(deleteIncomingMetricsSuccess(response.data));
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
            dispatch(deleteIncomingMetricsFailure(errorMsg));
        }
    );

    return promise;
};

export const deleteOutgoingMetricsRequest = () => ({
    type: types.DELETE_OUTGOING_METRICS_REQUEST,
});

export const deleteOutgoingMetricsSuccess = (payload: $TSFixMe) => ({
    type: types.DELETE_OUTGOING_METRICS_SUCCESS,
    payload,
});

export const deleteOutgoingMetricsFailure = (error: $TSFixMe) => ({
    type: types.DELETE_OUTGOING_METRICS_FAILURE,
    payload: error,
});

export const resetOutgoingDelete = () => ({
    type: types.RESET_OUTGOING_DELETE,
});

export const deleteOutgoingMetrics = ({ appId, key, metricId }: $TSFixMe) => (
    dispatch: $TSFixMe
) => {
    dispatch(deleteOutgoingMetricsRequest());

    const promise = deleteApi(
        `performanceMetric/${appId}/key/${key}/${metricId}`
    );

    promise.then(
        function(response) {
            dispatch(deleteOutgoingMetricsSuccess(response.data));
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
            dispatch(deleteOutgoingMetricsFailure(errorMsg));
        }
    );

    return promise;
};
