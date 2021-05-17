import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/incidentPriorities';
import errors from '../errors';

function fetchIncidentPrioritiesRequest() {
    return {
        type: types.FETCH_INCIDENT_PRIORITIES_REQUEST,
    };
}

function fetchIncidentPrioritiesSuccess(payload) {
    return {
        type: types.FETCH_INCIDENT_PRIORITIES_SUCCESS,
        payload,
    };
}

function fetchIncidentPrioritiesFailure(error) {
    return {
        type: types.FETCH_INCIDENT_PRIORITIES_FAILURE,
        payload: error,
    };
}

export function fetchIncidentPriorities(projectId, skip, limit) {
    return function(dispatch) {
        const promise = getApi(
            `incidentPriorities/${projectId}?skip=${skip || 0}&limit=${limit ||
                10}`
        );
        dispatch(fetchIncidentPrioritiesRequest());
        promise.then(
            function(incidentsPriorities) {
                dispatch(
                    fetchIncidentPrioritiesSuccess(incidentsPriorities.data)
                );
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
                dispatch(fetchIncidentPrioritiesFailure(errors(error)));
            }
        );
    };
}

export function createIncidentPriority(projectId, data) {
    return function(dispatch) {
        const promise = postApi(`incidentPriorities/${projectId}`, data);
        dispatch(createIncidentPriorityRequest());
        promise.then(
            function(incidentPriority) {
                dispatch(createIncidentPrioritySuccess(incidentPriority.data));
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
                dispatch(createIncidentPriorityFailure(errors(error)));
            }
        );
        return promise;
    };
}

function createIncidentPriorityRequest() {
    return {
        type: types.CREATE_INCIDENT_PRIORITY_REQUEST,
    };
}

function createIncidentPrioritySuccess(data) {
    return {
        type: types.CREATE_INCIDENT_PRIORITY_SUCCESS,
        payload: data,
    };
}

function createIncidentPriorityFailure(data) {
    return {
        type: types.CREATE_INCIDENT_PRIORITY_FAILURE,
        payload: data,
    };
}

export function updateIncidentPriority(projectId, data) {
    return function(dispatch) {
        const promise = putApi(`incidentPriorities/${projectId}`, data);
        dispatch(updateIncidentPriorityRequest());
        promise.then(
            function(incidentPriority) {
                dispatch(updateIncidentPrioritySuccess(incidentPriority.data));
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
                dispatch(updateIncidentPriorityFailure(errors(error)));
            }
        );
        return promise;
    };
}

function updateIncidentPriorityRequest() {
    return {
        type: types.UPDATE_INCIDENT_PRIORITY_REQUEST,
    };
}

function updateIncidentPrioritySuccess(data) {
    return {
        type: types.UPDATE_INCIDENT_PRIORITY_SUCCESS,
        payload: data,
    };
}

function updateIncidentPriorityFailure(data) {
    return {
        type: types.UPDATE_INCIDENT_PRIORITY_FAILURE,
        payload: data,
    };
}

export function deleteIncidentPriority(projectId, data) {
    return function(dispatch) {
        const promise = deleteApi(`incidentPriorities/${projectId}`, data);
        dispatch(deleteIncidentPriorityRequest());
        promise.then(
            function(incidentPriority) {
                dispatch(deleteIncidentPrioritySuccess(incidentPriority.data));
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
                dispatch(deleteIncidentPriorityFailure(errors(error)));
            }
        );
        return promise;
    };
}

function deleteIncidentPriorityRequest() {
    return {
        type: types.DELETE_INCIDENT_PRIORITY_REQUEST,
    };
}

function deleteIncidentPrioritySuccess(data) {
    return {
        type: types.DELETE_INCIDENT_PRIORITY_SUCCESS,
        payload: data,
    };
}

function deleteIncidentPriorityFailure(data) {
    return {
        type: types.DELETE_INCIDENT_PRIORITY_FAILURE,
        payload: data,
    };
}
