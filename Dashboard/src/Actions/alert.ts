import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/alert';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
export const resetAlert = (): void => {
    return {
        type: types.ALERT_FETCH_RESET,
    };
};

export const alertRequest = (promise: $TSFixMe): void => {
    return {
        type: types.ALERT_FETCH_REQUEST,
        payload: promise,
    };
};

export const alertError = (error: ErrorPayload): void => {
    return {
        type: types.ALERT_FETCH_FAILED,
        payload: error,
    };
};

export const alertSuccess = (alert: $TSFixMe): void => {
    return {
        type: types.ALERT_FETCH_SUCCESS,
        payload: alert,
    };
};

// Calls the API to fetch Alerts.

export const fetchAlert = (projectId: string): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(`alert/${projectId}`);

        dispatch(alertRequest());

        promise.then(
            function (payload): void {
                dispatch(alertSuccess(payload.data));
            },
            function (error): void {
                dispatch(alertError(error));
            }
        );

        return promise;
    };
};

export const resetProjectAlert = (): void => {
    return {
        type: types.PROJECT_ALERT_FETCH_RESET,
    };
};

export const projectAlertRequest = (promise: $TSFixMe): void => {
    return {
        type: types.PROJECT_ALERT_FETCH_REQUEST,
        payload: promise,
    };
};

export const projectAlertError = (error: ErrorPayload): void => {
    return {
        type: types.PROJECT_ALERT_FETCH_FAILED,
        payload: error,
    };
};

export const projectAlertSuccess = (alert: $TSFixMe): void => {
    return {
        type: types.PROJECT_ALERT_FETCH_SUCCESS,
        payload: alert,
    };
};

// Calls the API to fetch Alerts.

export function fetchProjectAlert(
    projectId: string,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `alert/${projectId}/alert?skip=${skip}&limit=${limit}`
        );

        dispatch(projectAlertRequest());

        promise.then(
            function (payload): void {
                const data = payload.data;
                data.projectId = projectId;
                dispatch(projectAlertSuccess(data));
            },
            function (error): void {
                dispatch(projectAlertError(error));
            }
        );

        return promise;
    };
}

// Incidents Alert
export const incidentResetAlert = (): void => {
    return {
        type: types.INCIDENTS_ALERT_FETCH_RESET,
    };
};

export const incidentAlertRequest = (promise: $TSFixMe): void => {
    return {
        type: types.INCIDENTS_ALERT_FETCH_REQUEST,
        payload: promise,
    };
};

export const incidentAlertError = (error: ErrorPayload): void => {
    return {
        type: types.INCIDENTS_ALERT_FETCH_FAILED,
        payload: error,
    };
};

export const incidentAlertSuccess = (alert: $TSFixMe): void => {
    return {
        type: types.INCIDENTS_ALERT_FETCH_SUCCESS,
        payload: alert,
    };
};

// Calls the API to fetch Alerts.

export function fetchIncidentAlert(
    projectId: string,
    incidentSlug: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `alert/${projectId}/incident/${incidentSlug}?skip=${skip}&limit=${limit}`
        );

        dispatch(incidentAlertRequest());

        promise.then(
            function (alerts): void {
                dispatch(incidentAlertSuccess(alerts.data));
            },
            function (error): void {
                dispatch(incidentAlertError(error));
            }
        );

        return promise;
    };
}

// Subscribers Alert

export const subscriberResetAlert = (): void => {
    return {
        type: types.SUBSCRIBERS_ALERT_FETCH_RESET,
    };
};

export const subscriberAlertRequest = (promise: $TSFixMe): void => {
    return {
        type: types.SUBSCRIBERS_ALERT_FETCH_REQUEST,
        payload: promise,
    };
};

export const subscriberAlertError = (error: ErrorPayload): void => {
    return {
        type: types.SUBSCRIBERS_ALERT_FETCH_FAILED,
        payload: error,
    };
};

export const subscriberAlertSuccess = (alert: $TSFixMe): void => {
    return {
        type: types.SUBSCRIBERS_ALERT_FETCH_SUCCESS,
        payload: alert,
    };
};

// Calls the API to fetch Subscriber Alerts.

export function fetchSubscriberAlert(
    projectId: string,
    incidentSlug: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    skip = parseInt(skip);
    limit = parseInt(limit);
    return function (dispatch: Dispatch): void {
        skip = skip < 0 ? 0 : skip;
        limit = limit < 0 ? 0 : limit;
        let promise = null;
        if (skip >= 0 && limit >= 0) {
            promise = BackendAPI.get(
                `subscriberAlert/${projectId}/incident/${incidentSlug}?skip=${skip}&limit=${limit}`
            );
        } else {
            promise = BackendAPI.get(
                `subscriberAlert/${projectId}/incident/${incidentSlug}`
            );
        }

        dispatch(subscriberAlertRequest());

        promise.then(
            function (alerts): void {
                dispatch(subscriberAlertSuccess(alerts.data));
            },
            function (error): void {
                dispatch(subscriberAlertError(error));
            }
        );

        return promise;
    };
}

export const fetchAlertChargesRequest = (promise: $TSFixMe): void => {
    return {
        type: types.FETCH_ALERT_CHARGES_REQUEST,
        payload: promise,
    };
};

export const fetchAlertChargesFailed = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_ALERT_CHARGES_FAILED,
        payload: error,
    };
};

export const fetchAlertChargesSuccess = (alertCharges: $TSFixMe): void => {
    return {
        type: types.FETCH_ALERT_CHARGES_SUCCESS,
        payload: alertCharges,
    };
};

export function fetchAlertCharges(
    projectId: string,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    let promise;
    return function (dispatch: Dispatch): void {
        if (skip >= 0 && limit > 0) {
            promise = BackendAPI.get(
                `alert/${projectId}/alert/charges?skip=${skip}&limit=${limit}`
            );
        } else {
            promise = BackendAPI.get(`alert/${projectId}/alert/charges`);
        }

        dispatch(fetchAlertChargesRequest(promise));

        promise.then(
            function (alertCharges): void {
                dispatch(fetchAlertChargesSuccess(alertCharges.data));
            },
            function (error): void {
                dispatch(fetchAlertChargesFailed(error));
            }
        );
        return promise;
    };
}

export const downloadAlertChargesRequest = (promise: $TSFixMe): void => {
    return {
        type: types.DOWNLOAD_ALERT_CHARGES_REQUEST,
        payload: promise,
    };
};

export const downloadAlertChargesFailed = (error: ErrorPayload): void => {
    return {
        type: types.DOWNLOAD_ALERT_CHARGES_FAILED,
        payload: error,
    };
};

export const downloadAlertChargesSuccess = (alertCharges: $TSFixMe): void => {
    return {
        type: types.DOWNLOAD_ALERT_CHARGES_SUCCESS,
        payload: alertCharges,
    };
};

export const downloadAlertCharges = (projectId: string): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(`alert/${projectId}/alert/charges`);

        dispatch(downloadAlertChargesRequest(promise));

        promise.then(
            function (alertCharges): void {
                dispatch(downloadAlertChargesSuccess(alertCharges.data));
            },
            function (error): void {
                dispatch(downloadAlertChargesFailed(error));
            }
        );
        return promise;
    };
};
