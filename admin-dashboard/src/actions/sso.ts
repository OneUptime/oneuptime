import * as types from '../constants/sso';
import errors from '../errors';
import { getApi, deleteApi, postApi, putApi } from '../api';

export const fetchSsosRequest = () => {
    return {
        type: types.FETCH_SSOS_REQUEST,
    };
};

export const fetchSsosSuccess = (payload: $TSFixMe) => {
    return {
        type: types.FETCH_SSOS_SUCCESS,
        payload,
    };
};

export const fetchSsosError = (payload: $TSFixMe) => {
    return {
        type: types.FETCH_SSOS_FAILURE,
        payload,
    };
};

export const fetchSsos = (skip: $TSFixMe, limit: $TSFixMe) => async (dispatch: $TSFixMe) => {
    skip = skip ? parseInt(skip) : 0;
    limit = limit ? parseInt(limit) : 10;
    dispatch(fetchSsosRequest());
    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await getApi(`sso/?skip=${skip}&limit=${limit}`);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
        dispatch(fetchSsosError(errors(errorMsg)));
    }
};

export const fetchSsoRequest = () => {
    return {
        type: types.FETCH_SSO_REQUEST,
    };
};

export const fetchSsoSuccess = (payload: $TSFixMe) => {
    return {
        type: types.FETCH_SSO_SUCCESS,
        payload,
    };
};

export const fetchSsoError = (payload: $TSFixMe) => {
    return {
        type: types.FETCH_SSO_FAILURE,
        payload,
    };
};

export const fetchSso = (ssoId: $TSFixMe) => async (dispatch: $TSFixMe) => {
    dispatch(fetchSsoRequest());
    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await getApi(`sso/${ssoId}`);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
        dispatch(fetchSsoError(errors(errorMsg)));
    }
};

export const deleteSsoRequest = () => {
    return {
        type: types.DELETE_SSO_REQUEST,
    };
};

export const deleteSsoSuccess = () => {
    return {
        type: types.DELETE_SSO_SUCCESS,
    };
};

export const deleteSsoError = (payload: $TSFixMe) => {
    return {
        type: types.DELETE_SSO_FAILED,
        payload,
    };
};

export const deleteSso = (ssoId: $TSFixMe) => async (dispatch: $TSFixMe) => {
    dispatch(deleteSsoRequest());
    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        await deleteApi(`sso/${ssoId}`);
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

export const addSsoRequest = () => {
    return {
        type: types.ADD_SSO_REQUEST,
    };
};

export const addSsoSuccess = () => {
    return {
        type: types.ADD_SSO_SUCCESS,
    };
};

export const addSsoError = (payload: $TSFixMe) => {
    return {
        type: types.ADD_SSO_FAILED,
        payload,
    };
};

export const addSso = ({
    data
}: $TSFixMe) => async (dispatch: $TSFixMe) => {
    dispatch(addSsoRequest());
    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await postApi(`sso/`, data);
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

export const updateSsoRequest = () => {
    return {
        type: types.UPDATE_SSO_REQUEST,
    };
};

export const updateSsoSuccess = () => {
    return {
        type: types.UPDATE_SSO_SUCCESS,
    };
};

export const updateSsoError = (payload: $TSFixMe) => {
    return {
        type: types.UPDATE_SSO_FAILURE,
        payload,
    };
};

export const updateSso = ({
    id,
    data
}: $TSFixMe) => async (dispatch: $TSFixMe) => {
    dispatch(updateSsoRequest());
    try {
        await putApi(`sso/${id}`, data);
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
