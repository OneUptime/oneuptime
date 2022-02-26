import * as types from '../constants/monitorCustomField';
import { postApi, getApi, deleteApi, putApi } from '../api';

export const createCustomFieldRequest = () => ({
    type: types.CREATE_CUSTOM_FIELD_REQUEST,
});

export const createCustomFieldSuccess = (payload: $TSFixMe) => ({
    type: types.CREATE_CUSTOM_FIELD_SUCCESS,
    payload
});

export const createCustomFieldFailure = (error: $TSFixMe) => ({
    type: types.CREATE_CUSTOM_FIELD_FAILURE,
    payload: error
});

export const createCustomField = (projectId: $TSFixMe, data: $TSFixMe) => async (dispatch: $TSFixMe) => {
    try {
        dispatch(createCustomFieldRequest());

        const response = await postApi(`monitorCustomField/${projectId}`, data);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
    payload
});

export const updateCustomFieldFailure = (error: $TSFixMe) => ({
    type: types.UPDATE_CUSTOM_FIELD_FAILURE,
    payload: error
});

export const updateCustomField = ({
    projectId,
    customFieldId,
    data
}: $TSFixMe) => async (dispatch: $TSFixMe) => {
    try {
        dispatch(updateCustomFieldRequest());

        const response = await putApi(
            `monitorCustomField/${projectId}/${customFieldId}`,
            data
        );
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
    payload
});

export const fetchCustomFieldsFailure = (error: $TSFixMe) => ({
    type: types.FETCH_CUSTOM_FIELDS_FAILURE,
    payload: error
});

export const fetchCustomFields = (
    projectId: $TSFixMe,
    skip = 0,
    limit = 0
) => async (dispatch: $TSFixMe) => {
    try {
        dispatch(fetchCustomFieldsRequest());

        let response;
        if (skip === 0 && limit === 0) {
            response = await getApi(`monitorCustomField/${projectId}`);
        } else {
            response = await getApi(
                `monitorCustomField/${projectId}?skip=${skip}&limit=${limit}`
            );
        }
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
    payload
});

export const deleteCustomFieldFailure = (error: $TSFixMe) => ({
    type: types.DELETE_CUSTOM_FIELD_FAILURE,
    payload: error
});

export const deleteCustomField = (
    projectId: $TSFixMe,
    customFieldId: $TSFixMe
) => async (dispatch: $TSFixMe) => {
    try {
        dispatch(deleteCustomFieldRequest());

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await deleteApi(
            `monitorCustomField/${projectId}/${customFieldId}`
        );
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
