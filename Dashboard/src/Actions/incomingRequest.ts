import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/incomingRequest';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
export const createIncomingRequestRequest: Function = (): void => {
    return {
        type: types.CREATE_INCOMING_REQUEST_REQUEST,
    };
};

export const createIncomingRequestSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.CREATE_INCOMING_REQUEST_SUCCESS,
        payload,
    };
};

export const createIncomingRequestFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.CREATE_INCOMING_REQUEST_FAILURE,
        payload: error,
    };
};

export const createIncomingRequest: $TSFixMe = (
    projectId: ObjectID,
    data: $TSFixMe
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(createIncomingRequestRequest());

            const response: $TSFixMe = await BackendAPI.post(
                `incoming-request/${projectId}/create-request-url`,
                data
            );

            dispatch(createIncomingRequestSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
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
};

export const editIncomingRequestRequest: Function = (): void => {
    return {
        type: types.EDIT_INCOMING_REQUEST_REQUEST,
    };
};

export const editIncomingRequestSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.EDIT_INCOMING_REQUEST_SUCCESS,
        payload,
    };
};

export const editIncomingRequestFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.EDIT_INCOMING_REQUEST_FAILURE,
        payload: error,
    };
};

export const editIncomingRequest: $TSFixMe = (
    projectId: ObjectID,
    requestId: $TSFixMe,
    data: $TSFixMe
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(editIncomingRequestRequest());

            const response: $TSFixMe = await BackendAPI.put(
                `incoming-request/${projectId}/update/${requestId}`,
                data
            );

            dispatch(editIncomingRequestSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
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
};

export const deleteIncomingRequestRequest: Function = (): void => {
    return {
        type: types.DELETE_INCOMING_REQUEST_REQUEST,
    };
};

export const deleteIncomingRequestSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.DELETE_INCOMING_REQUEST_SUCCESS,
        payload,
    };
};

export const deleteIncomingRequestFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.DELETE_INCOMING_REQUEST_FAILURE,
        payload: error,
    };
};

export const deleteIncomingRequest: $TSFixMe = (
    projectId: ObjectID,
    requestId: $TSFixMe
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(deleteIncomingRequestRequest());

            const response: $TSFixMe =
                await delete `incoming-request/${projectId}/remove/${requestId}`;

            dispatch(deleteIncomingRequestSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
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
};

export const fetchAllIncomingRequestRequest: Function = (): void => {
    return {
        type: types.FETCH_ALL_INCOMING_REQUEST_REQUEST,
    };
};

export const fetchAllIncomingRequestSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.FETCH_ALL_INCOMING_REQUEST_SUCCESS,
        payload,
    };
};

export const fetchAllIncomingRequestFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_ALL_INCOMING_REQUEST_FAILURE,
        payload: error,
    };
};

export const fetchAllIncomingRequest: $TSFixMe = (
    projectId: ObjectID,
    skip: PositiveNumber,
    limit: PositiveNumber
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(fetchAllIncomingRequestRequest());

            const response: $TSFixMe = await BackendAPI.get(
                `incoming-request/${projectId}/all-incoming-request?skip=${skip}&limit=${limit}`
            );

            dispatch(fetchAllIncomingRequestSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
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
};

export const setActiveIncomingRequest: Function = (
    requestId: $TSFixMe
): void => {
    return {
        type: types.SET_ACTIVE_INCOMING_REQUEST,
        payload: requestId,
    };
};

export const incomingRequestToggle: $TSFixMe = (
    projectId: ObjectID,
    requestId: $TSFixMe,
    enabled: $TSFixMe
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(editIncomingRequestRequest());
            const response: $TSFixMe = await BackendAPI.post(
                `incoming-request/${projectId}/toggle/${requestId}`,
                enabled
            );

            dispatch(editIncomingRequestSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
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
};
