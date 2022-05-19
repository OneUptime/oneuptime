import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/incidentPriorities';
import ErrorPayload from 'CommonUI/src/PayloadTypes/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
function fetchIncidentPrioritiesRequest(): void {
    return {
        type: types.FETCH_INCIDENT_PRIORITIES_REQUEST,
    };
}

function fetchIncidentPrioritiesSuccess(payload: $TSFixMe): void {
    return {
        type: types.FETCH_INCIDENT_PRIORITIES_SUCCESS,
        payload,
    };
}

function fetchIncidentPrioritiesFailure(error: ErrorPayload): void {
    return {
        type: types.FETCH_INCIDENT_PRIORITIES_FAILURE,
        payload: error,
    };
}

export function fetchIncidentPriorities(
    projectId: ObjectID,
    skip: PositiveNumber,
    limit: PositiveNumber
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `incidentPriorities/${projectId}?skip=${skip || 0}&limit=${
                limit || 10
            }`
        );
        dispatch(fetchIncidentPrioritiesRequest());
        promise.then(
            (incidentsPriorities: $TSFixMe): void => {
                dispatch(
                    fetchIncidentPrioritiesSuccess(incidentsPriorities.data)
                );
            },
            (error: $TSFixMe): void => {
                dispatch(fetchIncidentPrioritiesFailure(error));
            }
        );
    };
}

export const createIncidentPriority: Function = (
    projectId: ObjectID,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `incidentPriorities/${projectId}`,
            data
        );
        dispatch(createIncidentPriorityRequest());
        promise.then(
            (incidentPriority: $TSFixMe): void => {
                dispatch(createIncidentPrioritySuccess(incidentPriority.data));
            },
            (error: $TSFixMe): void => {
                dispatch(createIncidentPriorityFailure(error));
            }
        );
        return promise;
    };
};

function createIncidentPriorityRequest(): void {
    return {
        type: types.CREATE_INCIDENT_PRIORITY_REQUEST,
    };
}

function createIncidentPrioritySuccess(data: $TSFixMe): void {
    return {
        type: types.CREATE_INCIDENT_PRIORITY_SUCCESS,
        payload: data,
    };
}

function createIncidentPriorityFailure(data: $TSFixMe): void {
    return {
        type: types.CREATE_INCIDENT_PRIORITY_FAILURE,
        payload: data,
    };
}

export const updateIncidentPriority: Function = (
    projectId: ObjectID,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `incidentPriorities/${projectId}`,
            data
        );
        dispatch(updateIncidentPriorityRequest());
        promise.then(
            (incidentPriority: $TSFixMe): void => {
                dispatch(updateIncidentPrioritySuccess(incidentPriority.data));
            },
            (error: $TSFixMe): void => {
                dispatch(updateIncidentPriorityFailure(error));
            }
        );
        return promise;
    };
};

function updateIncidentPriorityRequest(): void {
    return {
        type: types.UPDATE_INCIDENT_PRIORITY_REQUEST,
    };
}

function updateIncidentPrioritySuccess(data: $TSFixMe): void {
    return {
        type: types.UPDATE_INCIDENT_PRIORITY_SUCCESS,
        payload: data,
    };
}

function updateIncidentPriorityFailure(data: $TSFixMe): void {
    return {
        type: types.UPDATE_INCIDENT_PRIORITY_FAILURE,
        payload: data,
    };
}

export const deleteIncidentPriority: Function = (
    projectId: ObjectID,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = delete (`incidentPriorities/${projectId}`,
        data);
        dispatch(deleteIncidentPriorityRequest());
        promise.then(
            (incidentPriority: $TSFixMe): void => {
                dispatch(deleteIncidentPrioritySuccess(incidentPriority.data));
            },
            (error: $TSFixMe): void => {
                dispatch(deleteIncidentPriorityFailure(error));
            }
        );
        return promise;
    };
};

function deleteIncidentPriorityRequest(): void {
    return {
        type: types.DELETE_INCIDENT_PRIORITY_REQUEST,
    };
}

function deleteIncidentPrioritySuccess(data: $TSFixMe): void {
    return {
        type: types.DELETE_INCIDENT_PRIORITY_SUCCESS,
        payload: data,
    };
}

function deleteIncidentPriorityFailure(data: $TSFixMe): void {
    return {
        type: types.DELETE_INCIDENT_PRIORITY_FAILURE,
        payload: data,
    };
}
