import * as types from '../constants/incidentCommunicationSla';
import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import ErrorPayload from 'CommonUI/src/payload-types/error';
export const createCommunicationSlaRequest: Function = (): void => ({
    type: types.CREATE_COMMUNICATION_SLA_REQUEST,
});

export const createCommunicationSlaSuccess: Function = (
    payload: $TSFixMe
): void => ({
    type: types.CREATE_COMMUNICATION_SLA_SUCCESS,
    payload,
});

export const createCommunicationSlaFailure: Function = (
    error: ErrorPayload
): void => ({
    type: types.CREATE_COMMUNICATION_SLA_FAILURE,
    payload: error,
});

export const createCommunicationSla =
    (projectId: ObjectID, data: $TSFixMe) => async (dispatch: Dispatch) => {
        try {
            dispatch(createCommunicationSlaRequest());

            const response = await BackendAPI.post(
                `incidentSla/${projectId}`,
                data
            );

            dispatch(createCommunicationSlaSuccess(response.data));
        } catch (error) {
            const errorMsg =
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

export const updateCommunicationSlaRequest: Function = (): void => ({
    type: types.UPDATE_COMMUNICATION_SLA_REQUEST,
});

export const updateCommunicationSlaSuccess: Function = (
    payload: $TSFixMe
): void => ({
    type: types.UPDATE_COMMUNICATION_SLA_SUCCESS,
    payload,
});

export const updateCommunicationSlaFailure: Function = (
    error: ErrorPayload
): void => ({
    type: types.UPDATE_COMMUNICATION_SLA_FAILURE,
    payload: error,
});

export const updateCommunicationSla =
    (
        projectId: ObjectID,
        incidentSlaId: $TSFixMe,
        data: $TSFixMe,
        handleDefault = false
    ) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(updateCommunicationSlaRequest());

            data.handleDefault = handleDefault;
            const response = await BackendAPI.put(
                `incidentSla/${projectId}/${incidentSlaId}`,
                data
            );

            dispatch(updateCommunicationSlaSuccess(response.data));
        } catch (error) {
            const errorMsg =
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

export const fetchCommunicationSlasRequest: Function = (): void => ({
    type: types.FETCH_COMMUNICATION_SLAS_REQUEST,
});

export const fetchCommunicationSlasSuccess: Function = (
    payload: $TSFixMe
): void => ({
    type: types.FETCH_COMMUNICATION_SLAS_SUCCESS,
    payload,
});

export const fetchCommunicationSlasFailure: Function = (
    error: ErrorPayload
): void => ({
    type: types.FETCH_COMMUNICATION_SLAS_FAILURE,
    payload: error,
});

export const fetchCommunicationSlas =
    (projectId: ObjectID, skip = 0, limit = 0) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(fetchCommunicationSlasRequest());

            let response;
            if (skip === 0 && limit === 0) {
                response = await BackendAPI.get(`incidentSla/${projectId}`);
            } else {
                response = await BackendAPI.get(
                    `incidentSla/${projectId}?skip=${skip}&limit=${limit}`
                );
            }

            dispatch(fetchCommunicationSlasSuccess(response.data));
        } catch (error) {
            const errorMsg =
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

export const deleteCommunicationSlaRequest: Function = (): void => ({
    type: types.DELETE_COMMUNICATION_SLA_REQUEST,
});

export const deleteCommunicationSlaSuccess: Function = (
    payload: $TSFixMe
): void => ({
    type: types.DELETE_COMMUNICATION_SLA_SUCCESS,
    payload,
});

export const deleteCommunicationSlaFailure: Function = (
    error: ErrorPayload
): void => ({
    type: types.DELETE_COMMUNICATION_SLA_FAILURE,
    payload: error,
});

export const deleteCommunicationSla =
    (projectId: ObjectID, incidentSlaId: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(deleteCommunicationSlaRequest());

            const response =
                await delete `incidentSla/${projectId}/${incidentSlaId}`;

            dispatch(deleteCommunicationSlaSuccess(response.data));
        } catch (error) {
            const errorMsg =
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

// set active sla
export const setActiveSla: Function = (incidentSlaId: $TSFixMe): void => ({
    type: types.SET_ACTIVE_SLA,
    payload: incidentSlaId,
});

export const fetchDefaultCommunicationSlaRequest: Function = (): void => ({
    type: types.FETCH_DEFAULT_COMMUNICATION_SLA_REQUEST,
});

export const fetchDefaultCommunicationSlaSuccess: Function = (
    payload: $TSFixMe
): void => ({
    type: types.FETCH_DEFAULT_COMMUNICATION_SLA_SUCCESS,
    payload,
});

export const fetchDefaultCommunicationSlaFailure: Function = (
    error: ErrorPayload
): void => ({
    type: types.FETCH_DEFAULT_COMMUNICATION_SLA_FAILURE,
    payload: error,
});

export const fetchDefaultCommunicationSla =
    (projectId: ObjectID) => async (dispatch: Dispatch) => {
        try {
            dispatch(fetchDefaultCommunicationSlaRequest());

            const response = await BackendAPI.get(
                `incidentSla/${projectId}/defaultCommunicationSla`
            );

            dispatch(fetchDefaultCommunicationSlaSuccess(response.data));
        } catch (error) {
            const errorMsg =
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
