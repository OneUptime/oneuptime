import { getApi } from '../api';
import * as types from '../constants/alert'
import errors from '../errors'

export function resetAlert() {
    return {
        type: types.ALERT_FETCH_RESET
    };
}

export function alertRequest(promise) {
    return {
        type: types.ALERT_FETCH_REQUEST,
        payload: promise
    };
}

export function alertError(error) {
    return {
        type: types.ALERT_FETCH_FAILED,
        payload: error
    };
}

export function alertSuccess(alert) {
    return {
        type: types.ALERT_FETCH_SUCCESS,
        payload: alert
    };
}

// Calls the API to fetch Alerts.

export function fetchAlert(projectId) {

    return function (dispatch) {

        var promise = getApi(`alert/${projectId}`);

        dispatch(alertRequest());

        promise.then(function (payload) {
            dispatch(alertSuccess(payload.data));

        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if(error && error.message){
				error = error.message;
            }
            else{
				error = 'Network Error';
			}
            dispatch(alertError(errors(error)));

        });

        return promise;
    };
}

export function resetProjectAlert() {
    return {
        type: types.PROJECT_ALERT_FETCH_RESET
    };
}

export function projectAlertRequest(promise) {
    return {
        type: types.PROJECT_ALERT_FETCH_REQUEST,
        payload: promise
    };
}

export function projectAlertError(error) {
    return {
        type: types.PROJECT_ALERT_FETCH_FAILED,
        payload: error
    };
}

export function projectAlertSuccess(alert) {
    return {
        type: types.PROJECT_ALERT_FETCH_SUCCESS,
        payload: alert
    };
}

// Calls the API to fetch Alerts.

export function fetchProjectAlert(projectId, skip, limit) {

    return function (dispatch) {

        var promise = getApi(`alert/${projectId}/alert?skip=${skip}&limit=${limit}`);

        dispatch(projectAlertRequest());

        promise.then(function (payload) {
            const data = payload.data;
			data.projectId = projectId;
            dispatch(projectAlertSuccess(data));

        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if(error && error.message){
				error = error.message;
            }
            else{
				error = 'Network Error';
			}
            dispatch(projectAlertError(errors(error)));

        });

        return promise;
    };
}

// Incidents Alert


export function incidentResetAlert() {
    return {
        type: types.INCIDENTS_ALERT_FETCH_RESET
    };
}

export function incidentAlertRequest(promise) {
    return {
        type: types.INCIDENTS_ALERT_FETCH_REQUEST,
        payload: promise
    };
}

export function incidentAlertError(error) {
    return {
        type: types.INCIDENTS_ALERT_FETCH_FAILED,
        payload: error
    };
}

export function incidentAlertSuccess(alert) {
    return {
        type: types.INCIDENTS_ALERT_FETCH_SUCCESS,
        payload: alert
    };
}

// Calls the API to fetch Alerts.

export function fetchIncidentAlert(projectId,incidentId,skip,limit) {

    return function (dispatch) {

        var promise = getApi(`alert/${projectId}/incident/${incidentId}?skip=${skip}&limit=${limit}`);

        dispatch(incidentAlertRequest());

        promise.then(function (alerts) {
            dispatch(incidentAlertSuccess(alerts.data));

        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if(error && error.message){
				error = error.message;
            }
            else{
				error = 'Network Error';
			}
            dispatch(incidentAlertError(errors(error)));

        });

        return promise;
    };
}

// Subscribers Alert


export function subscriberResetAlert() {
    return {
        type: types.SUBSCRIBERS_ALERT_FETCH_RESET
    };
}

export function subscriberAlertRequest(promise) {
    return {
        type: types.SUBSCRIBERS_ALERT_FETCH_REQUEST,
        payload: promise
    };
}

export function subscriberAlertError(error) {
    return {
        type: types.SUBSCRIBERS_ALERT_FETCH_FAILED,
        payload: error
    };
}

export function subscriberAlertSuccess(alert) {
    return {
        type: types.SUBSCRIBERS_ALERT_FETCH_SUCCESS,
        payload: alert
    };
}

// Calls the API to fetch Subscriber Alerts.

export function fetchSubscriberAlert(projectId, incidentId, skip, limit) {
    skip = parseInt(skip);
    limit = parseInt(limit);
    return function (dispatch) {
        skip = skip < 0 ? 0 : skip;
        limit = limit < 0 ? 0 : limit;
        if(skip >= 0 && limit >= 0){
            var promise = getApi(`subscriberAlert/${projectId}/incident/${incidentId}?skip=${skip}&limit=${limit}`);
        }else{
            promise = getApi(`subscriberAlert/${projectId}/incident/${incidentId}`);
        }

        dispatch(subscriberAlertRequest());

        promise.then(function (alerts) {
            dispatch(subscriberAlertSuccess(alerts.data));

        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if(error && error.message){
				error = error.message;
            }
            else{
				error = 'Network Error';
			}
            dispatch(subscriberAlertError(errors(error)));

        });

        return promise;
    };
}
