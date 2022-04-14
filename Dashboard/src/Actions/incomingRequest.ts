import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/incomingRequest';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
export const createIncomingRequestRequest: Function = (): void => ({
    type: types.CREATE_INCOMING_REQUEST_REQUEST,
});

export const createIncomingRequestSuccess: Function = (
    payload: $TSFixMe
): void => ({
    type: types.CREATE_INCOMING_REQUEST_SUCCESS,
    payload,
});

export const createIncomingRequestFailure: Function = (
    error: ErrorPayload
): void => ({
    type: types.CREATE_INCOMING_REQUEST_FAILURE,
    payload: error,
});

export const createIncomingRequest =
    (projectId: ObjectID, data: $TSFixMe) => async (dispatch: Dispatch) => {
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

export const editIncomingRequestRequest: Function = (): void => ({
    type: types.EDIT_INCOMING_REQUEST_REQUEST,
});

export const editIncomingRequestSuccess: Function = (
    payload: $TSFixMe
): void => ({
    type: types.EDIT_INCOMING_REQUEST_SUCCESS,
    payload,
});

export const editIncomingRequestFailure: Function = (
    error: ErrorPayload
): void => ({
    type: types.EDIT_INCOMING_REQUEST_FAILURE,
    payload: error,
});

export const editIncomingRequest =
    (projectId: ObjectID, requestId: $TSFixMe, data: $TSFixMe) =>
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

export const deleteIncomingRequestRequest: Function = (): void => ({
    type: types.DELETE_INCOMING_REQUEST_REQUEST,
});

export const deleteIncomingRequestSuccess: Function = (
    payload: $TSFixMe
): void => ({
    type: types.DELETE_INCOMING_REQUEST_SUCCESS,
    payload,
});

export const deleteIncomingRequestFailure: Function = (
    error: ErrorPayload
): void => ({
    type: types.DELETE_INCOMING_REQUEST_FAILURE,
    payload: error,
});

export const deleteIncomingRequest =
    (projectId: ObjectID, requestId: $TSFixMe) =>
    async (dispatch: Dispatch) => {
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

export const fetchAllIncomingRequestRequest: Function = (): void => ({
    type: types.FETCH_ALL_INCOMING_REQUEST_REQUEST,
});

export const fetchAllIncomingRequestSuccess: Function = (
    payload: $TSFixMe
): void => ({
    type: types.FETCH_ALL_INCOMING_REQUEST_SUCCESS,
    payload,
});

export const fetchAllIncomingRequestFailure: Function = (
    error: ErrorPayload
): void => ({
    type: types.FETCH_ALL_INCOMING_REQUEST_FAILURE,
    payload: error,
});

export const fetchAllIncomingRequest =
    (projectId: ObjectID, skip: PositiveNumber, limit: PositiveNumber) =>
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

export const setActiveIncomingRequest: Function = (
    requestId: $TSFixMe
): void => ({
    type: types.SET_ACTIVE_INCOMING_REQUEST,
    payload: requestId,
});

export const incomingRequestToggle =
    (projectId: ObjectID, requestId: $TSFixMe, enabled: $TSFixMe) =>
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
