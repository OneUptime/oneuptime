import * as types from '../constants/incidentCommunicationSla';
import { postApi, getApi, deleteApi, putApi } from '../api';

export const createCommunicationSlaRequest = () => ({
    type: types.CREATE_COMMUNICATION_SLA_REQUEST,
});

export const createCommunicationSlaSuccess = (payload: $TSFixMe) => ({
    type: types.CREATE_COMMUNICATION_SLA_SUCCESS,
    payload,
});

export const createCommunicationSlaFailure = (error: $TSFixMe) => ({
    type: types.CREATE_COMMUNICATION_SLA_FAILURE,
    payload: error,
});

export const createCommunicationSla =
    (projectId: $TSFixMe, data: $TSFixMe) => async (dispatch: $TSFixMe) => {
        try {
            dispatch(createCommunicationSlaRequest());

            const response = await postApi(`incidentSla/${projectId}`, data);

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

export const updateCommunicationSlaFailure = (error: $TSFixMe) => ({
    type: types.UPDATE_COMMUNICATION_SLA_FAILURE,
    payload: error,
});

export const updateCommunicationSla =
    (
        projectId: $TSFixMe,
        incidentSlaId: $TSFixMe,
        data: $TSFixMe,
        handleDefault = false
    ) =>
    async (dispatch: $TSFixMe) => {
        try {
            dispatch(updateCommunicationSlaRequest());

            data.handleDefault = handleDefault;
            const response = await putApi(
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

export const fetchCommunicationSlasFailure = (error: $TSFixMe) => ({
    type: types.FETCH_COMMUNICATION_SLAS_FAILURE,
    payload: error,
});

export const fetchCommunicationSlas =
    (projectId: $TSFixMe, skip = 0, limit = 0) =>
    async (dispatch: $TSFixMe) => {
        try {
            dispatch(fetchCommunicationSlasRequest());

            let response;
            if (skip === 0 && limit === 0) {
                response = await getApi(`incidentSla/${projectId}`);
            } else {
                response = await getApi(
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

export const deleteCommunicationSlaFailure = (error: $TSFixMe) => ({
    type: types.DELETE_COMMUNICATION_SLA_FAILURE,
    payload: error,
});

export const deleteCommunicationSla =
    (projectId: $TSFixMe, incidentSlaId: $TSFixMe) =>
    async (dispatch: $TSFixMe) => {
        try {
            dispatch(deleteCommunicationSlaRequest());

            const response = await deleteApi(
                `incidentSla/${projectId}/${incidentSlaId}`
            );

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

export const fetchDefaultCommunicationSlaFailure = (error: $TSFixMe) => ({
    type: types.FETCH_DEFAULT_COMMUNICATION_SLA_FAILURE,
    payload: error,
});

export const fetchDefaultCommunicationSla =
    (projectId: $TSFixMe) => async (dispatch: $TSFixMe) => {
        try {
            dispatch(fetchDefaultCommunicationSlaRequest());

            const response = await getApi(
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
