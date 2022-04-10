import * as types from '../constants/monitorCustomField';
import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ErrorPayload from 'CommonUI/src/payload-types/error';
export const createCustomFieldRequest = () => ({
    type: types.CREATE_CUSTOM_FIELD_REQUEST,
});

export const createCustomFieldSuccess = (payload: $TSFixMe) => ({
    type: types.CREATE_CUSTOM_FIELD_SUCCESS,
    payload,
});

export const createCustomFieldFailure = (error: ErrorPayload) => ({
    type: types.CREATE_CUSTOM_FIELD_FAILURE,
    payload: error,
});

export const createCustomField =
    (projectId: string, data: $TSFixMe) => async (dispatch: Dispatch) => {
        try {
            dispatch(createCustomFieldRequest());

            const response = await BackendAPI.post(
                `monitorCustomField/${projectId}`,
                data
            );

            dispatch(createCustomFieldSuccess(response.data));
        } catch (error) {
            const errorMsg =
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

export const updateCustomFieldRequest = () => ({
    type: types.UPDATE_CUSTOM_FIELD_REQUEST,
});

export const updateCustomFieldSuccess = (payload: $TSFixMe) => ({
    type: types.UPDATE_CUSTOM_FIELD_SUCCESS,
    payload,
});

export const updateCustomFieldFailure = (error: ErrorPayload) => ({
    type: types.UPDATE_CUSTOM_FIELD_FAILURE,
    payload: error,
});

export const updateCustomField =
    ({ projectId, customFieldId, data }: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(updateCustomFieldRequest());

            const response = await BackendAPI.put(
                `monitorCustomField/${projectId}/${customFieldId}`,
                data
            );

            dispatch(updateCustomFieldSuccess(response.data));
        } catch (error) {
            const errorMsg =
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

export const fetchCustomFieldsRequest = () => ({
    type: types.FETCH_CUSTOM_FIELDS_REQUEST,
});

export const fetchCustomFieldsSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_CUSTOM_FIELDS_SUCCESS,
    payload,
});

export const fetchCustomFieldsFailure = (error: ErrorPayload) => ({
    type: types.FETCH_CUSTOM_FIELDS_FAILURE,
    payload: error,
});

export const fetchCustomFields =
    (projectId: string, skip = 0, limit = 0) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(fetchCustomFieldsRequest());

            let response;
            if (skip === 0 && limit === 0) {
                response = await BackendAPI.get(
                    `monitorCustomField/${projectId}`
                );
            } else {
                response = await BackendAPI.get(
                    `monitorCustomField/${projectId}?skip=${skip}&limit=${limit}`
                );
            }

            dispatch(fetchCustomFieldsSuccess(response.data));
        } catch (error) {
            const errorMsg =
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

export const deleteCustomFieldRequest = () => ({
    type: types.DELETE_CUSTOM_FIELD_REQUEST,
});

export const deleteCustomFieldSuccess = (payload: $TSFixMe) => ({
    type: types.DELETE_CUSTOM_FIELD_SUCCESS,
    payload,
});

export const deleteCustomFieldFailure = (error: ErrorPayload) => ({
    type: types.DELETE_CUSTOM_FIELD_FAILURE,
    payload: error,
});

export const deleteCustomField =
    (projectId: string, customFieldId: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(deleteCustomFieldRequest());

            const response =
                await delete `monitorCustomField/${projectId}/${customFieldId}`;

            dispatch(deleteCustomFieldSuccess(response.data));
        } catch (error) {
            const errorMsg =
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
