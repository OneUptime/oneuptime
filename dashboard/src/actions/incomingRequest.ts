import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/incomingRequest';

export const createIncomingRequestRequest = () => ({
    type: types.CREATE_INCOMING_REQUEST_REQUEST,
});

export const createIncomingRequestSuccess = payload => ({
    type: types.CREATE_INCOMING_REQUEST_SUCCESS,
    payload,
});

export const createIncomingRequestFailure = error => ({
    type: types.CREATE_INCOMING_REQUEST_FAILURE,
    payload: error,
});

export const createIncomingRequest = (projectId, data) => async dispatch => {
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

export const editIncomingRequestSuccess = payload => ({
    type: types.EDIT_INCOMING_REQUEST_SUCCESS,
    payload,
});

export const editIncomingRequestFailure = error => ({
    type: types.EDIT_INCOMING_REQUEST_FAILURE,
    payload: error,
});

export const editIncomingRequest = (
    projectId,
    requestId,
    data
) => async dispatch => {
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

export const deleteIncomingRequestSuccess = payload => ({
    type: types.DELETE_INCOMING_REQUEST_SUCCESS,
    payload,
});

export const deleteIncomingRequestFailure = error => ({
    type: types.DELETE_INCOMING_REQUEST_FAILURE,
    payload: error,
});

export const deleteIncomingRequest = (
    projectId,
    requestId
) => async dispatch => {
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

export const fetchAllIncomingRequestSuccess = payload => ({
    type: types.FETCH_ALL_INCOMING_REQUEST_SUCCESS,
    payload,
});

export const fetchAllIncomingRequestFailure = error => ({
    type: types.FETCH_ALL_INCOMING_REQUEST_FAILURE,
    payload: error,
});

export const fetchAllIncomingRequest = (
    projectId,
    skip,
    limit
) => async dispatch => {
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

export const setActiveIncomingRequest = requestId => ({
    type: types.SET_ACTIVE_INCOMING_REQUEST,
    payload: requestId,
});

export const incomingRequestToggle = (
    projectId,
    requestId,
    enabled
) => async dispatch => {
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
