import { postApi, getApi, deleteApi } from '../api';
import * as types from '../constants/subscriber'
import errors from '../errors'
import { saveFile } from '../config'

// Create a new subscriber

export function createSubscriberRequest(promise) {
    return {
        type: types.CREATE_SUBSCRIBER_REQUEST,
        payload: promise
    };
}

export function createSubscriberError(error) {
    return {
        type: types.CREATE_SUBSCRIBER_FAILED,
        payload: error
    };
}

export function createSubscriberSuccess(subscriber) {
    return {
        type: types.CREATE_SUBSCRIBER_SUCCESS,
        payload: subscriber
    };
}

export const resetCreateSubscriber = () => {
    return {
        type: types.CREATE_SUBSCRIBER_RESET,
    };
};

// Calls the API to create new subscriber.
export function createSubscriber(projectId, monitorId, data) {

    return function (dispatch) {
        const promise = postApi(`subscriber/${projectId}/subscribe/${monitorId}`, data);

        dispatch(createSubscriberRequest(promise));

        promise.then(function (createSubscriber) {
            dispatch(createSubscriberSuccess(createSubscriber.data));
        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            }
            else {
                error = 'Network Error';
            }
            dispatch(createSubscriberError(errors(error)));
        });

        return promise;
    };
}

// Export subscribers to csv

export function exportCsvRequest(promise) {
    return {
        type: types.EXPORT_CSV_REQUEST,
        payload: promise
    };
}

export function exportCsvError(error) {
    return {
        type: types.EXPORT_CSV_FAILED,
        payload: error
    };
}

export function exportCsvSuccess(data) {
    return {
        type: types.EXPORT_CSV_SUCCESS,
        payload: data
    };
}

export const resetExportCsv = () => {
    return {
        type: types.EXPORT_CSV_RESET,
    };
};

// Calls the API to export subscribers to csv
export function exportCSV(projectId, monitorId, skip, limit, csv) {

    return function (dispatch) {
        const promise = getApi(`subscriber/${projectId}/monitor/${monitorId}?skip=${skip}&limit=${limit}&output-type=${csv}`);

        dispatch(exportCsvRequest(promise));

        promise.then(function (csvData) {
            saveFile(csvData.data.data, 'subscriber.csv');
            dispatch(exportCsvSuccess(csvData.data.data));
        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            }
            else {
                error = 'Network Error';
            }
            dispatch(exportCsvError(errors(error)));
        });

        return promise;
    };
}

// Delete a subscriber

export function deleteSubscriberRequest(promise) {
    return {
        type: types.DELETE_SUBSCRIBER_REQUEST,
        payload: promise
    };
}

export function deleteSubscriberError(error) {
    return {
        type: types.DELETE_SUBSCRIBER_FAILED,
        payload: error
    };
}

export function deleteSubscriberSuccess(subscriber) {
    return {
        type: types.DELETE_SUBSCRIBER_SUCCESS,
        payload: subscriber
    };
}

export const resetDeleteSubscriber = () => {
    return {
        type: types.DELETE_SUBSCRIBER_RESET,
    };
};

// Calls the API to delete a subscriber.
export function deleteSubscriber(projectId, subscriberId) {

    return function (dispatch) {
        const promise = deleteApi(`subscriber/${projectId}/${subscriberId}`, {});

        dispatch(deleteSubscriberRequest(promise));

        promise.then(function (subscriber) {
            dispatch(deleteSubscriberSuccess(subscriber.data));
            dispatch({
                type: 'REMOVE_MONITORS_SUBSCRIBERS',
                payload: subscriber.data
            });
        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            }
            else {
                error = 'Network Error';
            }
            dispatch(deleteSubscriberError(errors(error)));
        });

        return promise;
    };
}

