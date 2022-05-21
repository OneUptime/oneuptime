import * as types from '../constants/incidentCommunicationSla';
import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import ErrorPayload from 'CommonUI/src/PayloadTypes/error';
export const createCommunicationSlaRequest: Function = (): void => {
    return {
        type: types.CREATE_COMMUNICATION_SLA_REQUEST,
    };
};

export const createCommunicationSlaSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.CREATE_COMMUNICATION_SLA_SUCCESS,
        payload,
    };
};

export const createCommunicationSlaFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.CREATE_COMMUNICATION_SLA_FAILURE,
        payload: error,
    };
};

export const createCommunicationSla: $TSFixMe = (
    projectId: ObjectID,
    data: $TSFixMe
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(createCommunicationSlaRequest());

            const response: $TSFixMe = await BackendAPI.post(
                `incidentSla/${projectId}`,
                data
            );

            dispatch(createCommunicationSlaSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(createCommunicationSlaFailure(errorMsg));
        }
    };
};

export const updateCommunicationSlaRequest: Function = (): void => {
    return {
        type: types.UPDATE_COMMUNICATION_SLA_REQUEST,
    };
};

export const updateCommunicationSlaSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.UPDATE_COMMUNICATION_SLA_SUCCESS,
        payload,
    };
};

export const updateCommunicationSlaFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_COMMUNICATION_SLA_FAILURE,
        payload: error,
    };
};

export const updateCommunicationSla: $TSFixMe = (
    projectId: ObjectID,
    incidentSlaId: $TSFixMe,
    data: $TSFixMe,
    handleDefault: $TSFixMe = false
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(updateCommunicationSlaRequest());

            data.handleDefault = handleDefault;
            const response: $TSFixMe = await BackendAPI.put(
                `incidentSla/${projectId}/${incidentSlaId}`,
                data
            );

            dispatch(updateCommunicationSlaSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(updateCommunicationSlaFailure(errorMsg));
        }
    };
};

export const fetchCommunicationSlasRequest: Function = (): void => {
    return {
        type: types.FETCH_COMMUNICATION_SLAS_REQUEST,
    };
};

export const fetchCommunicationSlasSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.FETCH_COMMUNICATION_SLAS_SUCCESS,
        payload,
    };
};

export const fetchCommunicationSlasFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_COMMUNICATION_SLAS_FAILURE,
        payload: error,
    };
};

export const fetchCommunicationSlas: $TSFixMe = (
    projectId: ObjectID,
    skip: number = 0,
    limit: number = 0
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(fetchCommunicationSlasRequest());

            let response: $TSFixMe;
            if (skip === 0 && limit === 0) {
                response = await BackendAPI.get(`incidentSla/${projectId}`);
            } else {
                response = await BackendAPI.get(
                    `incidentSla/${projectId}?skip=${skip}&limit=${limit}`
                );
            }

            dispatch(fetchCommunicationSlasSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(fetchCommunicationSlasFailure(errorMsg));
        }
    };
};

export const deleteCommunicationSlaRequest: Function = (): void => {
    return {
        type: types.DELETE_COMMUNICATION_SLA_REQUEST,
    };
};

export const deleteCommunicationSlaSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.DELETE_COMMUNICATION_SLA_SUCCESS,
        payload,
    };
};

export const deleteCommunicationSlaFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.DELETE_COMMUNICATION_SLA_FAILURE,
        payload: error,
    };
};

export const deleteCommunicationSla: $TSFixMe = (
    projectId: ObjectID,
    incidentSlaId: $TSFixMe
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(deleteCommunicationSlaRequest());

            const response: $TSFixMe =
                delete `incidentSla/${projectId}/${incidentSlaId}`;

            dispatch(deleteCommunicationSlaSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(deleteCommunicationSlaFailure(errorMsg));
        }
    };
};

// Set active sla
export const setActiveSla: Function = (incidentSlaId: $TSFixMe): void => {
    return {
        type: types.SET_ACTIVE_SLA,
        payload: incidentSlaId,
    };
};

export const fetchDefaultCommunicationSlaRequest: Function = (): void => {
    return {
        type: types.FETCH_DEFAULT_COMMUNICATION_SLA_REQUEST,
    };
};

export const fetchDefaultCommunicationSlaSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.FETCH_DEFAULT_COMMUNICATION_SLA_SUCCESS,
        payload,
    };
};

export const fetchDefaultCommunicationSlaFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_DEFAULT_COMMUNICATION_SLA_FAILURE,
        payload: error,
    };
};

export const fetchDefaultCommunicationSla: $TSFixMe = (projectId: ObjectID) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(fetchDefaultCommunicationSlaRequest());

            const response: $TSFixMe = await BackendAPI.get(
                `incidentSla/${projectId}/defaultCommunicationSla`
            );

            dispatch(fetchDefaultCommunicationSlaSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(fetchDefaultCommunicationSlaFailure(errorMsg));
        }
    };
};
