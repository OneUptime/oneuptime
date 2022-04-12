import * as types from '../constants/sso';
import PositiveNumber from 'Common/Types/PositiveNumber';
import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';

export const fetchSsosRequest = (): void => {
    return {
        type: types.FETCH_SSOS_REQUEST,
    };
};

export const fetchSsosSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_SSOS_SUCCESS,
        payload,
    };
};

export const fetchSsosError = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_SSOS_FAILURE,
        payload,
    };
};

export const fetchSsos =
    (skip: PositiveNumber, limit: PositiveNumber) =>
    async (dispatch: Dispatch) => {
        skip = skip ? parseInt(skip) : 0;
        limit = limit ? parseInt(limit) : 10;
        dispatch(fetchSsosRequest());
        try {
            const response = await BackendAPI.get(
                `sso/?skip=${skip}&limit=${limit}`
            );

            dispatch(fetchSsosSuccess(response.data));
        } catch (error) {
            let errorMsg;
            if (error && error.response && error.response.data)
                errorMsg = error.response.data;
            if (error && error.data) {
                errorMsg = error.data;
            }
            if (error && error.message) {
                errorMsg = error.message;
            } else {
                errorMsg = 'Network Error';
            }
            dispatch(fetchSsosError(errorMsg));
        }
    };

export const fetchSsoRequest = (): void => {
    return {
        type: types.FETCH_SSO_REQUEST,
    };
};

export const fetchSsoSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_SSO_SUCCESS,
        payload,
    };
};

export const fetchSsoError = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_SSO_FAILURE,
        payload,
    };
};

export const fetchSso = (ssoId: $TSFixMe) => async (dispatch: Dispatch): void => {
    dispatch(fetchSsoRequest());
    try {
        const response = await BackendAPI.get(`sso/${ssoId}`);

        dispatch(fetchSsoSuccess(response.data));
    } catch (error) {
        let errorMsg;
        if (error && error.response && error.response.data)
            errorMsg = error.response.data;
        if (error && error.data) {
            errorMsg = error.data;
        }
        if (error && error.message) {
            errorMsg = error.message;
        } else {
            errorMsg = 'Network Error';
        }
        dispatch(fetchSsoError(errorMsg));
    }
};

export const deleteSsoRequest = (): void => {
    return {
        type: types.DELETE_SSO_REQUEST,
    };
};

export const deleteSsoSuccess = (): void => {
    return {
        type: types.DELETE_SSO_SUCCESS,
    };
};

export const deleteSsoError = (payload: $TSFixMe): void => {
    return {
        type: types.DELETE_SSO_FAILED,
        payload,
    };
};

export const deleteSso = (ssoId: $TSFixMe) => async (dispatch: Dispatch): void => {
    dispatch(deleteSsoRequest());
    try {
        await delete `sso/${ssoId}`;
        dispatch(deleteSsoSuccess());
    } catch (error) {
        let errorMsg;
        if (error && error.response && error.response.data)
            errorMsg = error.response.data;
        if (error && error.data) {
            errorMsg = error.data;
        }
        if (error && error.message) {
            errorMsg = error.message;
        } else {
            errorMsg = 'Network Error';
        }
        dispatch(deleteSsoError(errorMsg));
    }
};

export const addSsoRequest = (): void => {
    return {
        type: types.ADD_SSO_REQUEST,
    };
};

export const addSsoSuccess = (): void => {
    return {
        type: types.ADD_SSO_SUCCESS,
    };
};

export const addSsoError = (payload: $TSFixMe): void => {
    return {
        type: types.ADD_SSO_FAILED,
        payload,
    };
};

export const addSso =
    ({ data }: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        dispatch(addSsoRequest());
        try {
            await BackendAPI.post(`sso/`, data);
            dispatch(addSsoSuccess());
        } catch (error) {
            let errorMsg;
            if (error && error.response && error.response.data)
                errorMsg = error.response.data;
            if (error && error.data) {
                errorMsg = error.data;
            }
            if (error && error.message) {
                errorMsg = error.message;
            } else {
                errorMsg = 'Network Error';
            }
            dispatch(addSsoError(errorMsg));
        }
    };

export const updateSsoRequest = (): void => {
    return {
        type: types.UPDATE_SSO_REQUEST,
    };
};

export const updateSsoSuccess = (): void => {
    return {
        type: types.UPDATE_SSO_SUCCESS,
    };
};

export const updateSsoError = (payload: $TSFixMe): void => {
    return {
        type: types.UPDATE_SSO_FAILURE,
        payload,
    };
};

export const updateSso =
    ({ id, data }: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        dispatch(updateSsoRequest());
        try {
            await BackendAPI.put(`sso/${id}`, data);
            dispatch(updateSsoSuccess());
        } catch (error) {
            let errorMsg;
            if (error && error.response && error.response.data)
                errorMsg = error.response.data;
            if (error && error.data) {
                errorMsg = error.data;
            }
            if (error && error.message) {
                errorMsg = error.message;
            } else {
                errorMsg = 'Network Error';
            }
            dispatch(updateSsoError(errorMsg));
        }
    };
