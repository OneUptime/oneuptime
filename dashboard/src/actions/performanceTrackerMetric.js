import { getApi, deleteApi } from '../api';
import * as types from '../constants/performanceTrackerMetric';
import moment from 'moment';
import { encode } from 'js-base64';

// fetch performance tracker metrics - TIME
export const fetchTimeMetricsRequest = () => ({
    type: types.FETCH_TIME_METRICS_REQUEST,
});

export const fetchTimeMetricsSuccess = payload => ({
    type: types.FETCH_TIME_METRICS_SUCCESS,
    payload,
});

export const fetchTimeMetricsFailure = error => ({
    type: types.FETCH_TIME_METRICS_FAILURE,
    payload: error,
});

export const fetchTimeMetrics = ({
    appId,
    key,
    startDate,
    endDate,
}) => dispatch => {
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

export const fetchThroughputMetricsSuccess = payload => ({
    type: types.FETCH_THROUGHPUT_METRICS_SUCCESS,
    payload,
});

export const fetchThroughputMetricsFailure = error => ({
    type: types.FETCH_THROUGHPUT_METRICS_FAILURE,
    payload: error,
});

export const fetchThroughputMetrics = ({
    appId,
    key,
    startDate,
    endDate,
}) => dispatch => {
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
};

// handle setting startDate/endDate - (TIME || THROUGHPUT)
export const setTimeStartDate = date => ({
    type: types.SET_TIME_STARTDATE,
    payload: date,
});

export const setTimeEndDate = date => ({
    type: types.SET_TIME_ENDDATE,
    payload: date,
});

export const setThroughputStartDate = date => ({
    type: types.SET_THROUGHPUT_STARTDATE,
    payload: date,
});

export const setThroughputEndDate = date => ({
    type: types.SET_THROUGHPUT_ENDDATE,
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

export const resetIncomingDate = (startDate, endDate) => ({
    type: types.RESET_INCOMING_DATE,
    payload: { startDate, endDate },
});

export const resetOutgoingDate = (startDate, endDate) => ({
    type: types.RESET_OUTGOING_DATE,
    payload: { startDate, endDate },
});

// update metrics from realtime update
export const updateTimeMetrics = payload => ({
    type: types.UPDATE_TIME_METRICS,
    payload,
});

export const updateThroughputMetrics = payload => ({
    type: types.UPDATE_THROUGHPUT_METRICS,
    payload,
});

// fetch all performance metrics (incoming/outgoing)
export const fetchIncomingMetricsRequest = () => ({
    type: types.FETCH_INCOMING_METRICS_REQUEST,
});

export const fetchIncomingMetricsSuccess = payload => ({
    type: types.FETCH_INCOMING_METRICS_SUCCESS,
    payload,
});

export const fetchIncomingMetricsFailure = error => ({
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
}) => dispatch => {
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

export const fetchOutgoingMetricsSuccess = payload => ({
    type: types.FETCH_OUTGOING_METRICS_SUCCESS,
    payload,
});

export const fetchOutgoingMetricsFailing = error => ({
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
}) => dispatch => {
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

export const setIncomingStartDate = payload => ({
    type: types.SET_INCOMING_STARTDATE,
    payload,
});

export const setIncomingEndDate = payload => ({
    type: types.SET_INCOMING_ENDDATE,
    payload,
});

export const setOutgoingStartDate = payload => ({
    type: types.SET_OUTGOING_STARTDATE,
    payload,
});

export const setOutgoingEndDate = payload => ({
    type: types.SET_OUTGOING_ENDDATE,
    payload,
});

// delete a particular performance metrics (incoming/outgoing)
export const deleteIncomingMetricsRequest = () => ({
    type: types.DELETE_INCOMING_METRICS_REQUEST,
});

export const deleteIncomingMetricsSuccess = payload => ({
    type: types.DELETE_INCOMING_METRICS_SUCCESS,
    payload,
});

export const deleteIncomingMetricsFailure = error => ({
    type: types.DELETE_INCOMING_METRICS_FAILURE,
    payload: error,
});

export const resetIncomingDelete = () => ({
    type: types.RESET_INCOMING_DELETE,
});

export const deleteIncomingMetrics = ({ appId, key, metricId }) => dispatch => {
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

export const deleteOutgoingMetricsSuccess = payload => ({
    type: types.DELETE_OUTGOING_METRICS_SUCCESS,
    payload,
});

export const deleteOutgoingMetricsFailure = error => ({
    type: types.DELETE_OUTGOING_METRICS_FAILURE,
    payload: error,
});

export const resetOutgoingDelete = () => ({
    type: types.RESET_OUTGOING_DELETE,
});

export const deleteOutgoingMetrics = ({ appId, key, metricId }) => dispatch => {
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
