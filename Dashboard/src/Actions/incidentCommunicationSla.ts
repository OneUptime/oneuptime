import * as types from '../constants/incidentCommunicationSla';
import BackendAPI from 'common-ui/src/utils/api/backend';
import { Dispatch } from 'redux';
import ErrorPayload from 'common-ui/src/payload-types/error';
export const createCommunicationSlaRequest = () => ({
    type: types.CREATE_COMMUNICATION_SLA_REQUEST,
});

export const createCommunicationSlaSuccess = (payload: $TSFixMe) => ({
    type: types.CREATE_COMMUNICATION_SLA_SUCCESS,
    payload,
});

export const createCommunicationSlaFailure = (error: ErrorPayload) => ({
    type: types.CREATE_COMMUNICATION_SLA_FAILURE,
    payload: error,
});

export const createCommunicationSla =
    (projectId: string, data: $TSFixMe) => async (dispatch: Dispatch) => {
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

export const updateCommunicationSlaRequest = () => ({
    type: types.UPDATE_COMMUNICATION_SLA_REQUEST,
});

export const updateCommunicationSlaSuccess = (payload: $TSFixMe) => ({
    type: types.UPDATE_COMMUNICATION_SLA_SUCCESS,
    payload,
});

export const updateCommunicationSlaFailure = (error: ErrorPayload) => ({
    type: types.UPDATE_COMMUNICATION_SLA_FAILURE,
    payload: error,
});

export const updateCommunicationSla =
    (
        projectId: string,
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

export const fetchCommunicationSlasRequest = () => ({
    type: types.FETCH_COMMUNICATION_SLAS_REQUEST,
});

export const fetchCommunicationSlasSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_COMMUNICATION_SLAS_SUCCESS,
    payload,
});

export const fetchCommunicationSlasFailure = (error: ErrorPayload) => ({
    type: types.FETCH_COMMUNICATION_SLAS_FAILURE,
    payload: error,
});

export const fetchCommunicationSlas =
    (projectId: string, skip = 0, limit = 0) =>
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

export const deleteCommunicationSlaRequest = () => ({
    type: types.DELETE_COMMUNICATION_SLA_REQUEST,
});

export const deleteCommunicationSlaSuccess = (payload: $TSFixMe) => ({
    type: types.DELETE_COMMUNICATION_SLA_SUCCESS,
    payload,
});

export const deleteCommunicationSlaFailure = (error: ErrorPayload) => ({
    type: types.DELETE_COMMUNICATION_SLA_FAILURE,
    payload: error,
});

export const deleteCommunicationSla =
    (projectId: string, incidentSlaId: $TSFixMe) =>
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
export const setActiveSla = (incidentSlaId: $TSFixMe) => ({
    type: types.SET_ACTIVE_SLA,
    payload: incidentSlaId,
});

export const fetchDefaultCommunicationSlaRequest = () => ({
    type: types.FETCH_DEFAULT_COMMUNICATION_SLA_REQUEST,
});

export const fetchDefaultCommunicationSlaSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_DEFAULT_COMMUNICATION_SLA_SUCCESS,
    payload,
});

export const fetchDefaultCommunicationSlaFailure = (error: ErrorPayload) => ({
    type: types.FETCH_DEFAULT_COMMUNICATION_SLA_FAILURE,
    payload: error,
});

export const fetchDefaultCommunicationSla =
    (projectId: string) => async (dispatch: Dispatch) => {
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
