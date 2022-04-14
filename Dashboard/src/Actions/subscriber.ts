import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/subscriber';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
import { saveFile } from '../config';

// Create a new subscriber

export const createSubscriberRequest = (promise: $TSFixMe): void => {
    return {
        type: types.CREATE_SUBSCRIBER_REQUEST,
        payload: promise,
    };
};

export const createSubscriberError = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_SUBSCRIBER_FAILED,
        payload: error,
    };
};

export const createSubscriberSuccess = (subscriber: $TSFixMe): void => {
    return {
        type: types.CREATE_SUBSCRIBER_SUCCESS,
        payload: subscriber,
    };
};

export const resetCreateSubscriber = (): void => {
    return {
        type: types.CREATE_SUBSCRIBER_RESET,
    };
};

// Calls the API to create new subscriber.
export function createSubscriber(
    projectId: ObjectID,
    monitorId: $TSFixMe,
    data: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
            `subscriber/${projectId}/subscribe/${monitorId}`,
            data
        );

        dispatch(createSubscriberRequest(promise));

        promise.then(
            (createSubscriber): void => {
                dispatch(createSubscriberSuccess(createSubscriber.data));
            },
            (error): void => {
                dispatch(createSubscriberError(error));
            }
        );

        return promise;
    };
}

// Export subscribers to csv

export const exportCsvRequest = (promise: $TSFixMe): void => {
    return {
        type: types.EXPORT_CSV_REQUEST,
        payload: promise,
    };
};

export const exportCsvError = (error: ErrorPayload): void => {
    return {
        type: types.EXPORT_CSV_FAILED,
        payload: error,
    };
};

export const exportCsvSuccess = (data: $TSFixMe): void => {
    return {
        type: types.EXPORT_CSV_SUCCESS,
        payload: data,
    };
};

export const resetExportCsv = (): void => {
    return {
        type: types.EXPORT_CSV_RESET,
    };
};

// Calls the API to export subscribers to csv
export function exportCSV(
    projectId: ObjectID,
    monitorId: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber,
    csv: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `subscriber/${projectId}/monitor/${monitorId}?skip=${skip}&limit=${limit}&output-type=${csv}`
        );

        dispatch(exportCsvRequest(promise));

        promise.then(
            (csvData): void => {
                saveFile(csvData.data.data, 'subscriber.csv');

                dispatch(exportCsvSuccess(csvData.data.data));
            },
            (error): void => {
                dispatch(exportCsvError(error));
            }
        );

        return promise;
    };
}

// Delete a subscriber

export const deleteSubscriberRequest = (promise: $TSFixMe): void => {
    return {
        type: types.DELETE_SUBSCRIBER_REQUEST,
        payload: promise,
    };
};

export const deleteSubscriberError = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_SUBSCRIBER_FAILED,
        payload: error,
    };
};

export const deleteSubscriberSuccess = (subscriber: $TSFixMe): void => {
    return {
        type: types.DELETE_SUBSCRIBER_SUCCESS,
        payload: subscriber,
    };
};

export const resetDeleteSubscriber = (): void => {
    return {
        type: types.DELETE_SUBSCRIBER_RESET,
    };
};

// Calls the API to delete a subscriber.
export const deleteSubscriber = (
    projectId: ObjectID,
    subscriberId: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = delete (`subscriber/${projectId}/${subscriberId}`, {});

        dispatch(deleteSubscriberRequest(promise));

        promise.then(
            (subscriber): void => {
                dispatch(deleteSubscriberSuccess(subscriber.data));
                dispatch({
                    type: 'REMOVE_MONITORS_SUBSCRIBERS',

                    payload: subscriber.data,
                });
            },
            (error): void => {
                dispatch(deleteSubscriberError(error));
            }
        );

        return promise;
    };
};

// Import subscriber from csv
export const downloadCsvTemplateRequest = (): void => {
    return {
        type: types.DOWNLOAD_CSV_TEMPLATE_REQUEST,
    };
};

export const downloadCsvTemplateError = (error: ErrorPayload): void => {
    return {
        type: types.DOWNLOAD_CSV_TEMPLATE_FAILED,
        payload: error,
    };
};

export const downloadCsvTemplateSuccess = (): void => {
    return {
        type: types.DOWNLOAD_CSV_TEMPLATE_SUCCESS,
    };
};

/**
 * Downloads a CSV template
 */
export const downloadCsvTemplate = (): void => {
    const fields =
        'alertVia,contactEmail,contactPhone,countryCode,contactWebhook\nsms,,585-364-1200,us,\nemail,sampleemail@sample.com,,,\nwebhook,sampleemail1@sample.com,,,https://sample.com/webhook';
    return function (dispatch: Dispatch): void {
        dispatch(downloadCsvTemplateRequest());
        try {
            saveFile(fields, 'subscribers.csv');
            dispatch(downloadCsvTemplateSuccess());
        } catch (error) {
            dispatch(downloadCsvTemplateError(error));
        }
    };
};

/**
 * Imports data from a csv file
 * @param {*} data
 * @param {*} projectId
 * @param {*} monitorId
 */
export function importSubscribersFromCsvFile(
    data: $TSFixMe,
    projectId: ObjectID,
    monitorId: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
            `subscriber/${projectId}/${monitorId}/csv`,
            data
        );

        dispatch(createSubscriberRequest(promise));

        promise.then(
            (createSubscriber): void => {
                dispatch(createSubscriberSuccess(createSubscriber.data));
            },
            (error): void => {
                dispatch(createSubscriberError(error));
            }
        );

        return promise;
    };
}
