import * as types from '../constants/customField';
import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import ErrorPayload from 'CommonUI/src/PayloadTypes/error';
export const createCustomFieldRequest: Function = (): void => {
    return {
        type: types.CREATE_CUSTOM_FIELD_REQUEST,
    };
};

export const createCustomFieldSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.CREATE_CUSTOM_FIELD_SUCCESS,
        payload,
    };
};

export const createCustomFieldFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.CREATE_CUSTOM_FIELD_FAILURE,
        payload: error,
    };
};

export const createCustomField: $TSFixMe = (
    projectId: ObjectID,
    data: $TSFixMe
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(createCustomFieldRequest());

            const response: $TSFixMe = await BackendAPI.post(
                `customField/${projectId}`,
                data
            );

            dispatch(createCustomFieldSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(createCustomFieldFailure(errorMsg));
        }
    };
};

export const updateCustomFieldRequest: Function = (): void => {
    return {
        type: types.UPDATE_CUSTOM_FIELD_REQUEST,
    };
};

export const updateCustomFieldSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.UPDATE_CUSTOM_FIELD_SUCCESS,
        payload,
    };
};

export const updateCustomFieldFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_CUSTOM_FIELD_FAILURE,
        payload: error,
    };
};

export const updateCustomField: $TSFixMe = ({
    projectId,
    customFieldId,
    data,
}: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(updateCustomFieldRequest());

            const response: $TSFixMe = await BackendAPI.put(
                `customField/${projectId}/${customFieldId}`,
                data
            );

            dispatch(updateCustomFieldSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(updateCustomFieldFailure(errorMsg));
        }
    };
};

export const fetchCustomFieldsRequest: Function = (): void => {
    return {
        type: types.FETCH_CUSTOM_FIELDS_REQUEST,
    };
};

export const fetchCustomFieldsSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_CUSTOM_FIELDS_SUCCESS,
        payload,
    };
};

export const fetchCustomFieldsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_CUSTOM_FIELDS_FAILURE,
        payload: error,
    };
};

export const fetchCustomFields: $TSFixMe = (
    projectId: ObjectID,
    skip: number = 0,
    limit: number = 0
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(fetchCustomFieldsRequest());

            let response: $TSFixMe;
            if (skip === 0 && limit === 0) {
                response = await BackendAPI.get(`customField/${projectId}`);
            } else {
                response = await BackendAPI.get(
                    `customField/${projectId}?skip=${skip}&limit=${limit}`
                );
            }

            dispatch(fetchCustomFieldsSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(fetchCustomFieldsFailure(errorMsg));
        }
    };
};

export const deleteCustomFieldRequest: Function = (): void => {
    return {
        type: types.DELETE_CUSTOM_FIELD_REQUEST,
    };
};

export const deleteCustomFieldSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.DELETE_CUSTOM_FIELD_SUCCESS,
        payload,
    };
};

export const deleteCustomFieldFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.DELETE_CUSTOM_FIELD_FAILURE,
        payload: error,
    };
};

export const deleteCustomField: $TSFixMe = (
    projectId: ObjectID,
    customFieldId: $TSFixMe
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(deleteCustomFieldRequest());

            const response: $TSFixMe =
                await delete `customField/${projectId}/${customFieldId}`;

            dispatch(deleteCustomFieldSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(deleteCustomFieldFailure(errorMsg));
        }
    };
};

export const paginate: Function = (type: $TSFixMe): void => {
    if (type === 'next') {
        return { type: types.NEXT_PAGE };
    } else if (type === 'prev') {
        return { type: types.PREV_PAGE };
    }
};
