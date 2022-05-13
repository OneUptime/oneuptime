import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/sso';
import ErrorPayload from 'CommonUI/src/PayloadTypes/error';
export const createSsoRequest: Function = (): void => {
    return {
        type: types.CREATE_SSO_REQUEST,
    };
};
export const createSsoSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.CREATE_SSO_SUCCESS,
        payload,
    };
};
export const createSsoFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_SSO_FAILURE,
        payload: error,
    };
};
export const createSso: Function = ({ data }: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(`sso`, data);
        dispatch(createSsoRequest());

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(createSsoSuccess(response.data));
            },
            (error: $TSFixMe): void => {
                dispatch(createSsoFailure(error));
            }
        );
        return promise;
    };
};

export const fetchSsosRequest: Function = (): void => {
    return {
        type: types.FETCH_SSOS_REQUEST,
    };
};
export const fetchSsosSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_SSOS_SUCCESS,
        payload,
    };
};
export const fetchSsosFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_SSOS_FAILURE,
        payload: error,
    };
};
export const fetchSsos: Function = ({
    projectId,
    skip,
    limit,
}: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        skip = skip ? parseInt(skip) : 0;
        limit = limit ? parseInt(limit) : 10;

        const promise: $TSFixMe = BackendAPI.get(
            `sso/${projectId}/ssos?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchSsosRequest());

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(fetchSsosSuccess(response.data));
            },
            (error: $TSFixMe): void => {
                dispatch(fetchSsosFailure(error));
            }
        );
        return promise;
    };
};

export const fetchSsoRequest: Function = (): void => {
    return {
        type: types.FETCH_SSO_REQUEST,
    };
};
export const fetchSsoSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_SSO_SUCCESS,
        payload,
    };
};
export const fetchSsoFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_SSO_FAILURE,
        payload: error,
    };
};
export const fetchSso: Function = (ssoId: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(`sso/${ssoId}`);
        dispatch(fetchSsoRequest());

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(fetchSsoSuccess(response.data));
            },
            (error: $TSFixMe): void => {
                dispatch(fetchSsoFailure(error));
            }
        );
        return promise;
    };
};

export const updateSsoRequest: Function = (): void => {
    return {
        type: types.UPDATE_SSO_REQUEST,
    };
};
export const updateSsoSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.UPDATE_SSO_SUCCESS,
        payload,
    };
};
export const updateSsoFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.UPDATE_SSO_FAILURE,
        payload: error,
    };
};
export const updateSso: Function = ({ id, data }: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(`sso/${id}`, data);
        dispatch(updateSsoRequest());

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(updateSsoSuccess(response.data));
            },
            (error: $TSFixMe): void => {
                dispatch(updateSsoFailure(error));
            }
        );
        return promise;
    };
};

export const deleteSsoRequest: Function = (): void => {
    return {
        type: types.DELETE_SSO_REQUEST,
    };
};
export const deleteSsoSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.DELETE_SSO_SUCCESS,
        payload,
    };
};
export const deleteSsoFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_SSO_FAILURE,
        payload: error,
    };
};
export const deleteSso: Function = (ssoId: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = delete `sso/${ssoId}`;
        dispatch(deleteSsoRequest());

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(deleteSsoSuccess(response.data));
            },
            (error: $TSFixMe): void => {
                dispatch(deleteSsoFailure(error));
            }
        );
        return promise;
    };
};
