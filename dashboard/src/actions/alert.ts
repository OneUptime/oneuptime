import BackendAPI from 'common-ui/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/alert';
import ErrorPayload from 'common-ui/src/payload-types/error';
import PositiveNumber from 'common/Types/PositiveNumber';
export const resetAlert = () => {
    return {
        type: types.ALERT_FETCH_RESET,
    };
};

export const alertRequest = (promise: $TSFixMe) => {
    return {
        type: types.ALERT_FETCH_REQUEST,
        payload: promise,
    };
};

export const alertError = (error: ErrorPayload) => {
    return {
        type: types.ALERT_FETCH_FAILED,
        payload: error,
    };
};

export const alertSuccess = (alert: $TSFixMe) => {
    return {
        type: types.ALERT_FETCH_SUCCESS,
        payload: alert,
    };
};

// Calls the API to fetch Alerts.

export const fetchAlert = (projectId: string) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(`alert/${projectId}`);

        dispatch(alertRequest());

        promise.then(
            function (payload) {
                dispatch(alertSuccess(payload.data));
            },
            function (error) {
                dispatch(alertError(error));
            }
        );

        return promise;
    };
};

export const resetProjectAlert = () => {
    return {
        type: types.PROJECT_ALERT_FETCH_RESET,
    };
};

export const projectAlertRequest = (promise: $TSFixMe) => {
    return {
        type: types.PROJECT_ALERT_FETCH_REQUEST,
        payload: promise,
    };
};

export const projectAlertError = (error: ErrorPayload) => {
    return {
        type: types.PROJECT_ALERT_FETCH_FAILED,
        payload: error,
    };
};

export const projectAlertSuccess = (alert: $TSFixMe) => {
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
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `alert/${projectId}/alert?skip=${skip}&limit=${limit}`
        );

        dispatch(projectAlertRequest());

        promise.then(
            function (payload) {
                const data = payload.data;
                data.projectId = projectId;
                dispatch(projectAlertSuccess(data));
            },
            function (error) {
                dispatch(projectAlertError(error));
            }
        );

        return promise;
    };
}

// Incidents Alert
export const incidentResetAlert = () => {
    return {
        type: types.INCIDENTS_ALERT_FETCH_RESET,
    };
};

export const incidentAlertRequest = (promise: $TSFixMe) => {
    return {
        type: types.INCIDENTS_ALERT_FETCH_REQUEST,
        payload: promise,
    };
};

export const incidentAlertError = (error: ErrorPayload) => {
    return {
        type: types.INCIDENTS_ALERT_FETCH_FAILED,
        payload: error,
    };
};

export const incidentAlertSuccess = (alert: $TSFixMe) => {
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
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `alert/${projectId}/incident/${incidentSlug}?skip=${skip}&limit=${limit}`
        );

        dispatch(incidentAlertRequest());

        promise.then(
            function (alerts) {
                dispatch(incidentAlertSuccess(alerts.data));
            },
            function (error) {
                dispatch(incidentAlertError(error));
            }
        );

        return promise;
    };
}

// Subscribers Alert

export const subscriberResetAlert = () => {
    return {
        type: types.SUBSCRIBERS_ALERT_FETCH_RESET,
    };
};

export const subscriberAlertRequest = (promise: $TSFixMe) => {
    return {
        type: types.SUBSCRIBERS_ALERT_FETCH_REQUEST,
        payload: promise,
    };
};

export const subscriberAlertError = (error: ErrorPayload) => {
    return {
        type: types.SUBSCRIBERS_ALERT_FETCH_FAILED,
        payload: error,
    };
};

export const subscriberAlertSuccess = (alert: $TSFixMe) => {
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
    return function (dispatch: Dispatch) {
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
            function (alerts) {
                dispatch(subscriberAlertSuccess(alerts.data));
            },
            function (error) {
                dispatch(subscriberAlertError(error));
            }
        );

        return promise;
    };
}

export const fetchAlertChargesRequest = (promise: $TSFixMe) => {
    return {
        type: types.FETCH_ALERT_CHARGES_REQUEST,
        payload: promise,
    };
};

export const fetchAlertChargesFailed = (error: ErrorPayload) => {
    return {
        type: types.FETCH_ALERT_CHARGES_FAILED,
        payload: error,
    };
};

export const fetchAlertChargesSuccess = (alertCharges: $TSFixMe) => {
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
    return function (dispatch: Dispatch) {
        if (skip >= 0 && limit > 0) {
            promise = BackendAPI.get(
                `alert/${projectId}/alert/charges?skip=${skip}&limit=${limit}`
            );
        } else {
            promise = BackendAPI.get(`alert/${projectId}/alert/charges`);
        }

        dispatch(fetchAlertChargesRequest(promise));

        promise.then(
            function (alertCharges) {
                dispatch(fetchAlertChargesSuccess(alertCharges.data));
            },
            function (error) {
                dispatch(fetchAlertChargesFailed(error));
            }
        );
        return promise;
    };
}

export const downloadAlertChargesRequest = (promise: $TSFixMe) => {
    return {
        type: types.DOWNLOAD_ALERT_CHARGES_REQUEST,
        payload: promise,
    };
};

export const downloadAlertChargesFailed = (error: ErrorPayload) => {
    return {
        type: types.DOWNLOAD_ALERT_CHARGES_FAILED,
        payload: error,
    };
};

export const downloadAlertChargesSuccess = (alertCharges: $TSFixMe) => {
    return {
        type: types.DOWNLOAD_ALERT_CHARGES_SUCCESS,
        payload: alertCharges,
    };
};

export const downloadAlertCharges = (projectId: string) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(`alert/${projectId}/alert/charges`);

        dispatch(downloadAlertChargesRequest(promise));

        promise.then(
            function (alertCharges) {
                dispatch(downloadAlertChargesSuccess(alertCharges.data));
            },
            function (error) {
                dispatch(downloadAlertChargesFailed(error));
            }
        );
        return promise;
    };
};
