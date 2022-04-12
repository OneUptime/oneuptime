import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/incidentPriorities';
import ErrorPayload from 'CommonUI/src/payload-types/error';
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
    projectId: string,
    skip: PositiveNumber,
    limit: PositiveNumber
): void {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `incidentPriorities/${projectId}?skip=${skip || 0}&limit=${
                limit || 10
            }`
        );
        dispatch(fetchIncidentPrioritiesRequest());
        promise.then(
            function (incidentsPriorities): void {
                dispatch(
                    fetchIncidentPrioritiesSuccess(incidentsPriorities.data)
                );
            },
            function (error): void {
                dispatch(fetchIncidentPrioritiesFailure(error));
            }
        );
    };
}

export const createIncidentPriority = (
    projectId: string,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
            `incidentPriorities/${projectId}`,
            data
        );
        dispatch(createIncidentPriorityRequest());
        promise.then(
            function (incidentPriority): void {
                dispatch(createIncidentPrioritySuccess(incidentPriority.data));
            },
            function (error): void {
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

export const updateIncidentPriority = (
    projectId: string,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put(`incidentPriorities/${projectId}`, data);
        dispatch(updateIncidentPriorityRequest());
        promise.then(
            function (incidentPriority): void {
                dispatch(updateIncidentPrioritySuccess(incidentPriority.data));
            },
            function (error): void {
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

export const deleteIncidentPriority = (
    projectId: string,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = delete (`incidentPriorities/${projectId}`, data);
        dispatch(deleteIncidentPriorityRequest());
        promise.then(
            function (incidentPriority): void {
                dispatch(deleteIncidentPrioritySuccess(incidentPriority.data));
            },
            function (error): void {
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
