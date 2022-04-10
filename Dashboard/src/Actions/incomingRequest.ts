import BackendAPI from 'Common-ui/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/incomingRequest';
import ErrorPayload from 'Common-ui/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
export const createIncomingRequestRequest = () => ({
    type: types.CREATE_INCOMING_REQUEST_REQUEST,
});

export const createIncomingRequestSuccess = (payload: $TSFixMe) => ({
    type: types.CREATE_INCOMING_REQUEST_SUCCESS,
    payload,
});

export const createIncomingRequestFailure = (error: ErrorPayload) => ({
    type: types.CREATE_INCOMING_REQUEST_FAILURE,
    payload: error,
});

export const createIncomingRequest =
    (projectId: string, data: $TSFixMe) => async (dispatch: Dispatch) => {
        try {
            dispatch(createIncomingRequestRequest());

            const response = await BackendAPI.post(
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

export const editIncomingRequestFailure = (error: ErrorPayload) => ({
    type: types.EDIT_INCOMING_REQUEST_FAILURE,
    payload: error,
});

export const editIncomingRequest =
    (projectId: string, requestId: $TSFixMe, data: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(editIncomingRequestRequest());

            const response = await BackendAPI.put(
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

export const deleteIncomingRequestFailure = (error: ErrorPayload) => ({
    type: types.DELETE_INCOMING_REQUEST_FAILURE,
    payload: error,
});

export const deleteIncomingRequest =
    (projectId: string, requestId: $TSFixMe) => async (dispatch: Dispatch) => {
        try {
            dispatch(deleteIncomingRequestRequest());

            const response =
                await delete `incoming-request/${projectId}/remove/${requestId}`;

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

export const fetchAllIncomingRequestFailure = (error: ErrorPayload) => ({
    type: types.FETCH_ALL_INCOMING_REQUEST_FAILURE,
    payload: error,
});

export const fetchAllIncomingRequest =
    (projectId: string, skip: PositiveNumber, limit: PositiveNumber) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(fetchAllIncomingRequestRequest());

            const response = await BackendAPI.get(
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

export const incomingRequestToggle =
    (projectId: string, requestId: $TSFixMe, enabled: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(editIncomingRequestRequest());
            const response = await BackendAPI.post(
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
