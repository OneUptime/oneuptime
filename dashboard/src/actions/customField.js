import * as types from '../constants/customField';
import { postApi, getApi, deleteApi, putApi } from '../api';

export const createCustomFieldRequest = () => ({
    type: types.CREATE_CUSTOM_FIELD_REQUEST,
});

export const createCustomFieldSuccess = payload => ({
    type: types.CREATE_CUSTOM_FIELD_SUCCESS,
    payload,
});

export const createCustomFieldFailure = error => ({
    type: types.CREATE_CUSTOM_FIELD_FAILURE,
    payload: error,
});

export const createCustomField = (projectId, data) => async dispatch => {
    try {
        dispatch(createCustomFieldRequest());

        const response = await postApi(`customField/${projectId}`, data);
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

export const updateCustomFieldSuccess = payload => ({
    type: types.UPDATE_CUSTOM_FIELD_SUCCESS,
    payload,
});

export const updateCustomFieldFailure = error => ({
    type: types.UPDATE_CUSTOM_FIELD_FAILURE,
    payload: error,
});

export const updateCustomField = ({
    projectId,
    customFieldId,
    data,
}) => async dispatch => {
    try {
        dispatch(updateCustomFieldRequest());

        const response = await putApi(
            `customField/${projectId}/${customFieldId}`,
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

export const fetchCustomFieldsSuccess = payload => ({
    type: types.FETCH_CUSTOM_FIELDS_SUCCESS,
    payload,
});

export const fetchCustomFieldsFailure = error => ({
    type: types.FETCH_CUSTOM_FIELDS_FAILURE,
    payload: error,
});

export const fetchCustomFields = (
    projectId,
    skip = 0,
    limit = 0
) => async dispatch => {
    try {
        dispatch(fetchCustomFieldsRequest());

        let response;
        if (skip === 0 && limit === 0) {
            response = await getApi(`customField/${projectId}`);
        } else {
            response = await getApi(
                `customField/${projectId}?skip=${skip}&limit=${limit}`
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

export const deleteCustomFieldSuccess = payload => ({
    type: types.DELETE_CUSTOM_FIELD_SUCCESS,
    payload,
});

export const deleteCustomFieldFailure = error => ({
    type: types.DELETE_CUSTOM_FIELD_FAILURE,
    payload: error,
});

export const deleteCustomField = (
    projectId,
    customFieldId
) => async dispatch => {
    try {
        dispatch(deleteCustomFieldRequest());

        const response = await deleteApi(
            `customField/${projectId}/${customFieldId}`
        );
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
