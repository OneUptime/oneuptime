import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/sso';
import errors from '../errors';

export const createSsoRequest = () => ({
    type: types.CREATE_SSO_REQUEST,
});
export const createSsoSuccess = payload => ({
    type: types.CREATE_SSO_SUCCESS,
    payload,
});
export const createSsoFailure = error => ({
    type: types.CREATE_SSO_FAILURE,
    payload: error,
});
export function createSso({ data }) {
    return function(dispatch) {
        const promise = postApi(`sso`, data);
        dispatch(createSsoRequest());

        promise.then(
            function(response) {
                dispatch(createSsoSuccess(response.data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(createSsoFailure(errors(error)));
            }
        );
        return promise;
    };
}

export const fetchSsosRequest = () => ({
    type: types.FETCH_SSOS_REQUEST,
});
export const fetchSsosSuccess = payload => ({
    type: types.FETCH_SSOS_SUCCESS,
    payload,
});
export const fetchSsosFailure = error => ({
    type: types.FETCH_SSOS_FAILURE,
    payload: error,
});
export function fetchSsos({ projectId, skip, limit }) {
    return function(dispatch) {
        skip = skip ? parseInt(skip) : 0;
        limit = limit ? parseInt(limit) : 10;

        const promise = getApi(
            `sso/${projectId}/ssos?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchSsosRequest());

        promise.then(
            function(response) {
                dispatch(fetchSsosSuccess(response.data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(fetchSsosFailure(errors(error)));
            }
        );
        return promise;
    };
}

export const fetchSsoRequest = () => ({
    type: types.FETCH_SSO_REQUEST,
});
export const fetchSsoSuccess = payload => ({
    type: types.FETCH_SSO_SUCCESS,
    payload,
});
export const fetchSsoFailure = error => ({
    type: types.FETCH_SSO_FAILURE,
    payload: error,
});
export function fetchSso(ssoId) {
    return function(dispatch) {
        const promise = getApi(`sso/${ssoId}`);
        dispatch(fetchSsoRequest());

        promise.then(
            function(response) {
                dispatch(fetchSsoSuccess(response.data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(fetchSsoFailure(errors(error)));
            }
        );
        return promise;
    };
}

export const updateSsoRequest = () => ({
    type: types.UPDATE_SSO_REQUEST,
});
export const updateSsoSuccess = payload => ({
    type: types.UPDATE_SSO_SUCCESS,
    payload,
});
export const updateSsoFailure = error => ({
    type: types.UPDATE_SSO_FAILURE,
    payload: error,
});
export function updateSso({ id, data }) {
    return function(dispatch) {
        const promise = putApi(`sso/${id}`, data);
        dispatch(updateSsoRequest());

        promise.then(
            function(response) {
                dispatch(updateSsoSuccess(response.data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(updateSsoFailure(errors(error)));
            }
        );
        return promise;
    };
}

export const deleteSsoRequest = () => ({
    type: types.DELETE_SSO_REQUEST,
});
export const deleteSsoSuccess = payload => ({
    type: types.DELETE_SSO_SUCCESS,
    payload,
});
export const deleteSsoFailure = error => ({
    type: types.DELETE_SSO_FAILURE,
    payload: error,
});
export function deleteSso(ssoId) {
    return function(dispatch) {
        const promise = deleteApi(`sso/${ssoId}`);
        dispatch(deleteSsoRequest());

        promise.then(
            function(response) {
                dispatch(deleteSsoSuccess(response.data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(deleteSsoFailure(errors(error)));
            }
        );
        return promise;
    };
}
