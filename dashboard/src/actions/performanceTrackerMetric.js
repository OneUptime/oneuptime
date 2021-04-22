import { getApi } from '../api';
import * as types from '../constants/performanceTrackerMetric';
import moment from 'moment';

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

    startDate = moment(startDate)
        .utc()
        .format();
    endDate = moment(endDate)
        .utc()
        .format();
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

    startDate = moment(startDate)
        .utc()
        .format();
    endDate = moment(endDate)
        .utc()
        .format();
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
