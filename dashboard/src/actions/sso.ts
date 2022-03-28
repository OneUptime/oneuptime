import BackendAPI from 'common-ui/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/sso';
import ErrorPayload from 'common-ui/src/payload-types/error';
export const createSsoRequest = () => ({
    type: types.CREATE_SSO_REQUEST,
});
export const createSsoSuccess = (payload: $TSFixMe) => ({
    type: types.CREATE_SSO_SUCCESS,
    payload,
});
export const createSsoFailure = (error: ErrorPayload) => ({
    type: types.CREATE_SSO_FAILURE,
    payload: error,
});
export const createSso = ({ data }: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(`sso`, data);
        dispatch(createSsoRequest());

        promise.then(
            function (response) {
                dispatch(createSsoSuccess(response.data));
            },
            function (error) {
                dispatch(createSsoFailure(error));
            }
        );
        return promise;
    };
};

export const fetchSsosRequest = () => ({
    type: types.FETCH_SSOS_REQUEST,
});
export const fetchSsosSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_SSOS_SUCCESS,
    payload,
});
export const fetchSsosFailure = (error: ErrorPayload) => ({
    type: types.FETCH_SSOS_FAILURE,
    payload: error,
});
export const fetchSsos = ({ projectId, skip, limit }: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        skip = skip ? parseInt(skip) : 0;
        limit = limit ? parseInt(limit) : 10;

        const promise = BackendAPI.get(
            `sso/${projectId}/ssos?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchSsosRequest());

        promise.then(
            function (response) {
                dispatch(fetchSsosSuccess(response.data));
            },
            function (error) {
                dispatch(fetchSsosFailure(error));
            }
        );
        return promise;
    };
};

export const fetchSsoRequest = () => ({
    type: types.FETCH_SSO_REQUEST,
});
export const fetchSsoSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_SSO_SUCCESS,
    payload,
});
export const fetchSsoFailure = (error: ErrorPayload) => ({
    type: types.FETCH_SSO_FAILURE,
    payload: error,
});
export const fetchSso = (ssoId: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(`sso/${ssoId}`);
        dispatch(fetchSsoRequest());

        promise.then(
            function (response) {
                dispatch(fetchSsoSuccess(response.data));
            },
            function (error) {
                dispatch(fetchSsoFailure(error));
            }
        );
        return promise;
    };
};

export const updateSsoRequest = () => ({
    type: types.UPDATE_SSO_REQUEST,
});
export const updateSsoSuccess = (payload: $TSFixMe) => ({
    type: types.UPDATE_SSO_SUCCESS,
    payload,
});
export const updateSsoFailure = (error: ErrorPayload) => ({
    type: types.UPDATE_SSO_FAILURE,
    payload: error,
});
export const updateSso = ({ id, data }: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(`sso/${id}`, data);
        dispatch(updateSsoRequest());

        promise.then(
            function (response) {
                dispatch(updateSsoSuccess(response.data));
            },
            function (error) {
                dispatch(updateSsoFailure(error));
            }
        );
        return promise;
    };
};

export const deleteSsoRequest = () => ({
    type: types.DELETE_SSO_REQUEST,
});
export const deleteSsoSuccess = (payload: $TSFixMe) => ({
    type: types.DELETE_SSO_SUCCESS,
    payload,
});
export const deleteSsoFailure = (error: ErrorPayload) => ({
    type: types.DELETE_SSO_FAILURE,
    payload: error,
});
export const deleteSso = (ssoId: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = delete `sso/${ssoId}`;
        dispatch(deleteSsoRequest());

        promise.then(
            function (response) {
                dispatch(deleteSsoSuccess(response.data));
            },
            function (error) {
                dispatch(deleteSsoFailure(error));
            }
        );
        return promise;
    };
};
