import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/sso';
import errors from '../errors';

export const createSsoRequest = () => ({
    type: types.CREATE_SSO_REQUEST,
});
export const createSsoSuccess = (payload: $TSFixMe) => ({
    type: types.CREATE_SSO_SUCCESS,
    payload,
});
export const createSsoFailure = (error: $TSFixMe) => ({
    type: types.CREATE_SSO_FAILURE,
    payload: error,
});
export function createSso({ data }: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = postApi(`sso`, data);
        dispatch(createSsoRequest());

        promise.then(
            function(response) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
export const fetchSsosSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_SSOS_SUCCESS,
    payload,
});
export const fetchSsosFailure = (error: $TSFixMe) => ({
    type: types.FETCH_SSOS_FAILURE,
    payload: error,
});
export function fetchSsos({ projectId, skip, limit }: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        skip = skip ? parseInt(skip) : 0;
        limit = limit ? parseInt(limit) : 10;

        const promise = getApi(
            `sso/${projectId}/ssos?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchSsosRequest());

        promise.then(
            function(response) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
export const fetchSsoSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_SSO_SUCCESS,
    payload,
});
export const fetchSsoFailure = (error: $TSFixMe) => ({
    type: types.FETCH_SSO_FAILURE,
    payload: error,
});
export function fetchSso(ssoId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = getApi(`sso/${ssoId}`);
        dispatch(fetchSsoRequest());

        promise.then(
            function(response) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
export const updateSsoSuccess = (payload: $TSFixMe) => ({
    type: types.UPDATE_SSO_SUCCESS,
    payload,
});
export const updateSsoFailure = (error: $TSFixMe) => ({
    type: types.UPDATE_SSO_FAILURE,
    payload: error,
});
export function updateSso({ id, data }: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = putApi(`sso/${id}`, data);
        dispatch(updateSsoRequest());

        promise.then(
            function(response) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
export const deleteSsoSuccess = (payload: $TSFixMe) => ({
    type: types.DELETE_SSO_SUCCESS,
    payload,
});
export const deleteSsoFailure = (error: $TSFixMe) => ({
    type: types.DELETE_SSO_FAILURE,
    payload: error,
});
export function deleteSso(ssoId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const promise = deleteApi(`sso/${ssoId}`);
        dispatch(deleteSsoRequest());

        promise.then(
            function(response) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
