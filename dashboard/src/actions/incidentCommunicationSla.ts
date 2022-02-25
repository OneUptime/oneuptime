import * as types from '../constants/incidentCommunicationSla';
import { postApi, getApi, deleteApi, putApi } from '../api';

export const createCommunicationSlaRequest = () => ({
    type: types.CREATE_COMMUNICATION_SLA_REQUEST,
});

export const createCommunicationSlaSuccess = payload => ({
    type: types.CREATE_COMMUNICATION_SLA_SUCCESS,
    payload,
});

export const createCommunicationSlaFailure = error => ({
    type: types.CREATE_COMMUNICATION_SLA_FAILURE,
    payload: error,
});

export const createCommunicationSla = (projectId, data) => async dispatch => {
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

export const updateCommunicationSlaSuccess = payload => ({
    type: types.UPDATE_COMMUNICATION_SLA_SUCCESS,
    payload,
});

export const updateCommunicationSlaFailure = error => ({
    type: types.UPDATE_COMMUNICATION_SLA_FAILURE,
    payload: error,
});

export const updateCommunicationSla = (
    projectId,
    incidentSlaId,
    data,
    handleDefault = false
) => async dispatch => {
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

export const fetchCommunicationSlasSuccess = payload => ({
    type: types.FETCH_COMMUNICATION_SLAS_SUCCESS,
    payload,
});

export const fetchCommunicationSlasFailure = error => ({
    type: types.FETCH_COMMUNICATION_SLAS_FAILURE,
    payload: error,
});

export const fetchCommunicationSlas = (
    projectId,
    skip = 0,
    limit = 0
) => async dispatch => {
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

export const deleteCommunicationSlaSuccess = payload => ({
    type: types.DELETE_COMMUNICATION_SLA_SUCCESS,
    payload,
});

export const deleteCommunicationSlaFailure = error => ({
    type: types.DELETE_COMMUNICATION_SLA_FAILURE,
    payload: error,
});

export const deleteCommunicationSla = (
    projectId,
    incidentSlaId
) => async dispatch => {
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
export const setActiveSla = incidentSlaId => ({
    type: types.SET_ACTIVE_SLA,
    payload: incidentSlaId,
});

export const fetchDefaultCommunicationSlaRequest = () => ({
    type: types.FETCH_DEFAULT_COMMUNICATION_SLA_REQUEST,
});

export const fetchDefaultCommunicationSlaSuccess = payload => ({
    type: types.FETCH_DEFAULT_COMMUNICATION_SLA_SUCCESS,
    payload,
});

export const fetchDefaultCommunicationSlaFailure = error => ({
    type: types.FETCH_DEFAULT_COMMUNICATION_SLA_FAILURE,
    payload: error,
});

export const fetchDefaultCommunicationSla = projectId => async dispatch => {
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
