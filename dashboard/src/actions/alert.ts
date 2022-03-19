import { getApi } from '../api';
import * as types from '../constants/alert';
import errors from '../errors';

export const resetAlert = () => {
    return {
        type: types.ALERT_FETCH_RESET,
    };
}

export const alertRequest = (promise: $TSFixMe) => {
    return {
        type: types.ALERT_FETCH_REQUEST,
        payload: promise,
    };
}

export const alertError = (error: $TSFixMe) => {
    return {
        type: types.ALERT_FETCH_FAILED,
        payload: error,
    };
}

export const alertSuccess = (alert: $TSFixMe) => {
    return {
        type: types.ALERT_FETCH_SUCCESS,
        payload: alert,
    };
}

// Calls the API to fetch Alerts.

export const fetchAlert = (projectId: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        const promise = getApi(`alert/${projectId}`);

        dispatch(alertRequest());

        promise.then(
            function (payload) {
                dispatch(alertSuccess(payload.data));
            },
            function (error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(alertError(errors(error)));
            }
        );

        return promise;
    };
}

export const resetProjectAlert = () => {
    return {
        type: types.PROJECT_ALERT_FETCH_RESET,
    };
}

export const projectAlertRequest = (promise: $TSFixMe) => {
    return {
        type: types.PROJECT_ALERT_FETCH_REQUEST,
        payload: promise,
    };
}

export const projectAlertError = (error: $TSFixMe) => {
    return {
        type: types.PROJECT_ALERT_FETCH_FAILED,
        payload: error,
    };
}

export const projectAlertSuccess = (alert: $TSFixMe) => {
    return {
        type: types.PROJECT_ALERT_FETCH_SUCCESS,
        payload: alert,
    };
}

// Calls the API to fetch Alerts.

export function fetchProjectAlert(
    projectId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = getApi(
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
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(projectAlertError(errors(error)));
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
}

export const incidentAlertRequest = (promise: $TSFixMe) => {
    return {
        type: types.INCIDENTS_ALERT_FETCH_REQUEST,
        payload: promise,
    };
}

export const incidentAlertError = (error: $TSFixMe) => {
    return {
        type: types.INCIDENTS_ALERT_FETCH_FAILED,
        payload: error,
    };
}

export const incidentAlertSuccess = (alert: $TSFixMe) => {
    return {
        type: types.INCIDENTS_ALERT_FETCH_SUCCESS,
        payload: alert,
    };
}

// Calls the API to fetch Alerts.

export function fetchIncidentAlert(
    projectId: $TSFixMe,
    incidentSlug: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = getApi(
            `alert/${projectId}/incident/${incidentSlug}?skip=${skip}&limit=${limit}`
        );

        dispatch(incidentAlertRequest());

        promise.then(
            function (alerts) {
                dispatch(incidentAlertSuccess(alerts.data));
            },
            function (error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(incidentAlertError(errors(error)));
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
}

export const subscriberAlertRequest = (promise: $TSFixMe) => {
    return {
        type: types.SUBSCRIBERS_ALERT_FETCH_REQUEST,
        payload: promise,
    };
}

export const subscriberAlertError = (error: $TSFixMe) => {
    return {
        type: types.SUBSCRIBERS_ALERT_FETCH_FAILED,
        payload: error,
    };
}

export const subscriberAlertSuccess = (alert: $TSFixMe) => {
    return {
        type: types.SUBSCRIBERS_ALERT_FETCH_SUCCESS,
        payload: alert,
    };
}

// Calls the API to fetch Subscriber Alerts.

export function fetchSubscriberAlert(
    projectId: $TSFixMe,
    incidentSlug: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) {
    skip = parseInt(skip);
    limit = parseInt(limit);
    return function (dispatch: $TSFixMe) {
        skip = skip < 0 ? 0 : skip;
        limit = limit < 0 ? 0 : limit;
        let promise = null;
        if (skip >= 0 && limit >= 0) {
            promise = getApi(
                `subscriberAlert/${projectId}/incident/${incidentSlug}?skip=${skip}&limit=${limit}`
            );
        } else {
            promise = getApi(
                `subscriberAlert/${projectId}/incident/${incidentSlug}`
            );
        }

        dispatch(subscriberAlertRequest());

        promise.then(
            function (alerts) {
                dispatch(subscriberAlertSuccess(alerts.data));
            },
            function (error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(subscriberAlertError(errors(error)));
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
}

export const fetchAlertChargesFailed = (error: $TSFixMe) => {
    return {
        type: types.FETCH_ALERT_CHARGES_FAILED,
        payload: error,
    };
}

export const fetchAlertChargesSuccess = (alertCharges: $TSFixMe) => {
    return {
        type: types.FETCH_ALERT_CHARGES_SUCCESS,
        payload: alertCharges,
    };
}

export function fetchAlertCharges(
    projectId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) {
    let promise;
    return function (dispatch: $TSFixMe) {
        if (skip >= 0 && limit > 0) {
            promise = getApi(
                `alert/${projectId}/alert/charges?skip=${skip}&limit=${limit}`
            );
        } else {
            promise = getApi(`alert/${projectId}/alert/charges`);
        }

        dispatch(fetchAlertChargesRequest(promise));

        promise.then(
            function (alertCharges) {
                dispatch(fetchAlertChargesSuccess(alertCharges.data));
            },
            function (error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
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
}

export const downloadAlertChargesFailed = (error: $TSFixMe) => {
    return {
        type: types.DOWNLOAD_ALERT_CHARGES_FAILED,
        payload: error,
    };
}

export const downloadAlertChargesSuccess = (alertCharges: $TSFixMe) => {
    return {
        type: types.DOWNLOAD_ALERT_CHARGES_SUCCESS,
        payload: alertCharges,
    };
}

export const downloadAlertCharges = (projectId: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        const promise = getApi(`alert/${projectId}/alert/charges`);

        dispatch(downloadAlertChargesRequest(promise));

        promise.then(
            function (alertCharges) {
                dispatch(downloadAlertChargesSuccess(alertCharges.data));
            },
            function (error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(downloadAlertChargesFailed(error));
            }
        );
        return promise;
    };
}
