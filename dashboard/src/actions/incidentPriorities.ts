import { postApi, getApi, deleteApi, putApi } from '../api';
import { Dispatch } from 'redux';
import * as types from '../constants/incidentPriorities';
import errors from '../errors';

function fetchIncidentPrioritiesRequest() {
    return {
        type: types.FETCH_INCIDENT_PRIORITIES_REQUEST,
    };
}

function fetchIncidentPrioritiesSuccess(payload: $TSFixMe) {
    return {
        type: types.FETCH_INCIDENT_PRIORITIES_SUCCESS,
        payload,
    };
}

function fetchIncidentPrioritiesFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_INCIDENT_PRIORITIES_FAILURE,
        payload: error,
    };
}

export function fetchIncidentPriorities(
    projectId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = getApi(
            `incidentPriorities/${projectId}?skip=${skip || 0}&limit=${
                limit || 10
            }`
        );
        dispatch(fetchIncidentPrioritiesRequest());
        promise.then(
            function (incidentsPriorities) {
                dispatch(
                    fetchIncidentPrioritiesSuccess(incidentsPriorities.data)
                );
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
                dispatch(fetchIncidentPrioritiesFailure(errors(error)));
            }
        );
    };
}

export const createIncidentPriority = (projectId: $TSFixMe, data: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = postApi(`incidentPriorities/${projectId}`, data);
        dispatch(createIncidentPriorityRequest());
        promise.then(
            function (incidentPriority) {
                dispatch(createIncidentPrioritySuccess(incidentPriority.data));
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
                dispatch(createIncidentPriorityFailure(errors(error)));
            }
        );
        return promise;
    };
};

function createIncidentPriorityRequest() {
    return {
        type: types.CREATE_INCIDENT_PRIORITY_REQUEST,
    };
}

function createIncidentPrioritySuccess(data: $TSFixMe) {
    return {
        type: types.CREATE_INCIDENT_PRIORITY_SUCCESS,
        payload: data,
    };
}

function createIncidentPriorityFailure(data: $TSFixMe) {
    return {
        type: types.CREATE_INCIDENT_PRIORITY_FAILURE,
        payload: data,
    };
}

export const updateIncidentPriority = (projectId: $TSFixMe, data: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = putApi(`incidentPriorities/${projectId}`, data);
        dispatch(updateIncidentPriorityRequest());
        promise.then(
            function (incidentPriority) {
                dispatch(updateIncidentPrioritySuccess(incidentPriority.data));
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
                dispatch(updateIncidentPriorityFailure(errors(error)));
            }
        );
        return promise;
    };
};

function updateIncidentPriorityRequest() {
    return {
        type: types.UPDATE_INCIDENT_PRIORITY_REQUEST,
    };
}

function updateIncidentPrioritySuccess(data: $TSFixMe) {
    return {
        type: types.UPDATE_INCIDENT_PRIORITY_SUCCESS,
        payload: data,
    };
}

function updateIncidentPriorityFailure(data: $TSFixMe) {
    return {
        type: types.UPDATE_INCIDENT_PRIORITY_FAILURE,
        payload: data,
    };
}

export const deleteIncidentPriority = (projectId: $TSFixMe, data: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = deleteApi(`incidentPriorities/${projectId}`, data);
        dispatch(deleteIncidentPriorityRequest());
        promise.then(
            function (incidentPriority) {
                dispatch(deleteIncidentPrioritySuccess(incidentPriority.data));
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
                dispatch(deleteIncidentPriorityFailure(errors(error)));
            }
        );
        return promise;
    };
};

function deleteIncidentPriorityRequest() {
    return {
        type: types.DELETE_INCIDENT_PRIORITY_REQUEST,
    };
}

function deleteIncidentPrioritySuccess(data: $TSFixMe) {
    return {
        type: types.DELETE_INCIDENT_PRIORITY_SUCCESS,
        payload: data,
    };
}

function deleteIncidentPriorityFailure(data: $TSFixMe) {
    return {
        type: types.DELETE_INCIDENT_PRIORITY_FAILURE,
        payload: data,
    };
}
