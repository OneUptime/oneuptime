import { getApi } from '../api';
import * as types from '../constants/alert';
import errors from '../errors';

export function resetAlert() {
    return {
        type: types.ALERT_FETCH_RESET,
    };
}

export function alertRequest(promise: $TSFixMe) {
    return {
        type: types.ALERT_FETCH_REQUEST,
        payload: promise,
    };
}

export function alertError(error: $TSFixMe) {
    return {
        type: types.ALERT_FETCH_FAILED,
        payload: error,
    };
}

export function alertSuccess(alert: $TSFixMe) {
    return {
        type: types.ALERT_FETCH_SUCCESS,
        payload: alert,
    };
}

// Calls the API to fetch Alerts.

export function fetchAlert(projectId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = getApi(`alert/${projectId}`);

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 0.
        dispatch(alertRequest());

        promise.then(
            function(payload) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(alertSuccess(payload.data));
            },
            function(error) {
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

export function resetProjectAlert() {
    return {
        type: types.PROJECT_ALERT_FETCH_RESET,
    };
}

export function projectAlertRequest(promise: $TSFixMe) {
    return {
        type: types.PROJECT_ALERT_FETCH_REQUEST,
        payload: promise,
    };
}

export function projectAlertError(error: $TSFixMe) {
    return {
        type: types.PROJECT_ALERT_FETCH_FAILED,
        payload: error,
    };
}

export function projectAlertSuccess(alert: $TSFixMe) {
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
    return function(dispatch: $TSFixMe) {
        const promise = getApi(
            `alert/${projectId}/alert?skip=${skip}&limit=${limit}`
        );

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 0.
        dispatch(projectAlertRequest());

        promise.then(
            function(payload) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                const data = payload.data;
                data.projectId = projectId;
                dispatch(projectAlertSuccess(data));
            },
            function(error) {
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
export function incidentResetAlert() {
    return {
        type: types.INCIDENTS_ALERT_FETCH_RESET,
    };
}

export function incidentAlertRequest(promise: $TSFixMe) {
    return {
        type: types.INCIDENTS_ALERT_FETCH_REQUEST,
        payload: promise,
    };
}

export function incidentAlertError(error: $TSFixMe) {
    return {
        type: types.INCIDENTS_ALERT_FETCH_FAILED,
        payload: error,
    };
}

export function incidentAlertSuccess(alert: $TSFixMe) {
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
    return function(dispatch: $TSFixMe) {
        const promise = getApi(
            `alert/${projectId}/incident/${incidentSlug}?skip=${skip}&limit=${limit}`
        );

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 0.
        dispatch(incidentAlertRequest());

        promise.then(
            function(alerts) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(incidentAlertSuccess(alerts.data));
            },
            function(error) {
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

export function subscriberResetAlert() {
    return {
        type: types.SUBSCRIBERS_ALERT_FETCH_RESET,
    };
}

export function subscriberAlertRequest(promise: $TSFixMe) {
    return {
        type: types.SUBSCRIBERS_ALERT_FETCH_REQUEST,
        payload: promise,
    };
}

export function subscriberAlertError(error: $TSFixMe) {
    return {
        type: types.SUBSCRIBERS_ALERT_FETCH_FAILED,
        payload: error,
    };
}

export function subscriberAlertSuccess(alert: $TSFixMe) {
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
    return function(dispatch: $TSFixMe) {
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

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 0.
        dispatch(subscriberAlertRequest());

        promise.then(
            function(alerts) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(subscriberAlertSuccess(alerts.data));
            },
            function(error) {
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

export function fetchAlertChargesRequest(promise: $TSFixMe) {
    return {
        type: types.FETCH_ALERT_CHARGES_REQUEST,
        payload: promise,
    };
}

export function fetchAlertChargesFailed(error: $TSFixMe) {
    return {
        type: types.FETCH_ALERT_CHARGES_FAILED,
        payload: error,
    };
}

export function fetchAlertChargesSuccess(alertCharges: $TSFixMe) {
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
    return function(dispatch: $TSFixMe) {
        if (skip >= 0 && limit > 0) {
            promise = getApi(
                `alert/${projectId}/alert/charges?skip=${skip}&limit=${limit}`
            );
        } else {
            promise = getApi(`alert/${projectId}/alert/charges`);
        }

        dispatch(fetchAlertChargesRequest(promise));

        promise.then(
            function(alertCharges) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(fetchAlertChargesSuccess(alertCharges.data));
            },
            function(error) {
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

export function downloadAlertChargesRequest(promise: $TSFixMe) {
    return {
        type: types.DOWNLOAD_ALERT_CHARGES_REQUEST,
        payload: promise,
    };
}

export function downloadAlertChargesFailed(error: $TSFixMe) {
    return {
        type: types.DOWNLOAD_ALERT_CHARGES_FAILED,
        payload: error,
    };
}

export function downloadAlertChargesSuccess(alertCharges: $TSFixMe) {
    return {
        type: types.DOWNLOAD_ALERT_CHARGES_SUCCESS,
        payload: alertCharges,
    };
}

export function downloadAlertCharges(projectId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = getApi(`alert/${projectId}/alert/charges`);

        dispatch(downloadAlertChargesRequest(promise));

        promise.then(
            function(alertCharges) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(downloadAlertChargesSuccess(alertCharges.data));
            },
            function(error) {
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
