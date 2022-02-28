import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/incomingRequest';

export const createIncomingRequestRequest = () => ({
    type: types.CREATE_INCOMING_REQUEST_REQUEST,
});

export const createIncomingRequestSuccess = (payload: $TSFixMe) => ({
    type: types.CREATE_INCOMING_REQUEST_SUCCESS,
    payload,
});

export const createIncomingRequestFailure = (error: $TSFixMe) => ({
    type: types.CREATE_INCOMING_REQUEST_FAILURE,
    payload: error,
});

export const createIncomingRequest = (
    projectId: $TSFixMe,
    data: $TSFixMe
) => async (dispatch: $TSFixMe) => {
    try {
        dispatch(createIncomingRequestRequest());

        const response = await postApi(
            `incoming-request/${projectId}/create-request-url`,
            data
        );

        dispatch(createIncomingRequestSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(createIncomingRequestFailure(errorMsg));
    }
};

export const editIncomingRequestRequest = () => ({
    type: types.EDIT_INCOMING_REQUEST_REQUEST,
});

export const editIncomingRequestSuccess = (payload: $TSFixMe) => ({
    type: types.EDIT_INCOMING_REQUEST_SUCCESS,
    payload,
});

export const editIncomingRequestFailure = (error: $TSFixMe) => ({
    type: types.EDIT_INCOMING_REQUEST_FAILURE,
    payload: error,
});

export const editIncomingRequest = (
    projectId: $TSFixMe,
    requestId: $TSFixMe,
    data: $TSFixMe
) => async (dispatch: $TSFixMe) => {
    try {
        dispatch(editIncomingRequestRequest());

        const response = await putApi(
            `incoming-request/${projectId}/update/${requestId}`,
            data
        );

        dispatch(editIncomingRequestSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(editIncomingRequestFailure(errorMsg));
    }
};

export const deleteIncomingRequestRequest = () => ({
    type: types.DELETE_INCOMING_REQUEST_REQUEST,
});

export const deleteIncomingRequestSuccess = (payload: $TSFixMe) => ({
    type: types.DELETE_INCOMING_REQUEST_SUCCESS,
    payload,
});

export const deleteIncomingRequestFailure = (error: $TSFixMe) => ({
    type: types.DELETE_INCOMING_REQUEST_FAILURE,
    payload: error,
});

export const deleteIncomingRequest = (
    projectId: $TSFixMe,
    requestId: $TSFixMe
) => async (dispatch: $TSFixMe) => {
    try {
        dispatch(deleteIncomingRequestRequest());

        const response = await deleteApi(
            `incoming-request/${projectId}/remove/${requestId}`
        );

        dispatch(deleteIncomingRequestSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(deleteIncomingRequestFailure(errorMsg));
    }
};

export const fetchAllIncomingRequestRequest = () => ({
    type: types.FETCH_ALL_INCOMING_REQUEST_REQUEST,
});

export const fetchAllIncomingRequestSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_ALL_INCOMING_REQUEST_SUCCESS,
    payload,
});

export const fetchAllIncomingRequestFailure = (error: $TSFixMe) => ({
    type: types.FETCH_ALL_INCOMING_REQUEST_FAILURE,
    payload: error,
});

export const fetchAllIncomingRequest = (
    projectId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) => async (dispatch: $TSFixMe) => {
    try {
        dispatch(fetchAllIncomingRequestRequest());

        const response = await getApi(
            `incoming-request/${projectId}/all-incoming-request?skip=${skip}&limit=${limit}`
        );

        dispatch(fetchAllIncomingRequestSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(fetchAllIncomingRequestFailure(errorMsg));
    }
};

export const setActiveIncomingRequest = (requestId: $TSFixMe) => ({
    type: types.SET_ACTIVE_INCOMING_REQUEST,
    payload: requestId,
});

export const incomingRequestToggle = (
    projectId: $TSFixMe,
    requestId: $TSFixMe,
    enabled: $TSFixMe
) => async (dispatch: $TSFixMe) => {
    try {
        dispatch(editIncomingRequestRequest());
        const response = await postApi(
            `incoming-request/${projectId}/toggle/${requestId}`,
            enabled
        );

        dispatch(editIncomingRequestSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(editIncomingRequestFailure(errorMsg));
    }
};
