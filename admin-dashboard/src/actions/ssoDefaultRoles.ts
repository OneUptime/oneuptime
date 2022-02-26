import * as types from '../constants/ssoDefaultRoles';
import errors from '../errors';
import { getApi, deleteApi, postApi, putApi } from '../api';

export const fetchSsoDefaultRolesRequest = () => {
    return {
        type: types.FETCH_SSO_DEFAULT_ROLES_REQUEST,
    };
};

export const fetchSsoDefaultRolesSuccess = (payload: $TSFixMe) => {
    return {
        type: types.FETCH_SSO_DEFAULT_ROLES_SUCCESS,
        payload,
    };
};

export const fetchSsoDefaultRolesError = (payload: $TSFixMe) => {
    return {
        type: types.FETCH_SSO_DEFAULT_ROLES_FAILURE,
        payload,
    };
};

export const fetchSsoDefaultRoles = (skip: $TSFixMe, limit: $TSFixMe) => async (dispatch: $TSFixMe) => {
    skip = skip ? parseInt(skip) : 0;
    limit = limit ? parseInt(limit) : 10;
    dispatch(fetchSsoDefaultRolesRequest());
    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await getApi(
            `ssoDefaultRoles/?skip=${skip}&limit=${limit}`
        );
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        return dispatch(fetchSsoDefaultRolesSuccess(response.data));
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
        return dispatch(fetchSsoDefaultRolesError(errors(errorMsg)));
    }
};

export const fetchSsoDefaultRoleRequest = () => {
    return {
        type: types.FETCH_SSO_DEFAULT_ROLE_REQUEST,
    };
};

export const fetchSsoDefaultRoleSuccess = (payload: $TSFixMe) => {
    return {
        type: types.FETCH_SSO_DEFAULT_ROLE_SUCCESS,
        payload,
    };
};

export const fetchSsoDefaultRoleError = (payload: $TSFixMe) => {
    return {
        type: types.FETCH_SSO_DEFAULT_ROLE_FAILURE,
        payload,
    };
};

export const fetchSsoDefaultRole = (ssoDefaultRoleId: $TSFixMe) => async (dispatch: $TSFixMe) => {
    dispatch(fetchSsoDefaultRoleRequest());
    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await getApi(`ssoDefaultRoles/${ssoDefaultRoleId}`);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        dispatch(fetchSsoDefaultRoleSuccess(response.data));
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
        dispatch(fetchSsoDefaultRoleError(errors(errorMsg)));
    }
};

export const deleteSsoDefaultRoleRequest = () => {
    return {
        type: types.DELETE_SSO_DEFAULT_ROLE_REQUEST,
    };
};

export const deleteSsoDefaultRoleSuccess = (payload: $TSFixMe) => {
    return {
        type: types.DELETE_SSO_DEFAULT_ROLE_SUCCESS,
        payload,
    };
};

export const deleteSsoDefaultRoleError = (payload: $TSFixMe) => {
    return {
        type: types.DELETE_SSO_DEFAULT_ROLE_FAILED,
        payload,
    };
};

export const deleteSsoDefaultRole = (ssoId: $TSFixMe) => async (dispatch: $TSFixMe) => {
    dispatch(deleteSsoDefaultRoleRequest());
    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await deleteApi(`ssoDefaultRoles/${ssoId}`);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        dispatch(deleteSsoDefaultRoleSuccess(response.data));
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 0.
        dispatch(fetchSsoDefaultRoles());
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
        dispatch(deleteSsoDefaultRoleError(errorMsg));
    }
};

export const addSsoDefaultRoleRequest = () => {
    return {
        type: types.ADD_SSO_DEFAULT_ROLE_REQUEST,
    };
};

export const addSsoDefaultRoleSuccess = () => {
    return {
        type: types.ADD_SSO_DEFAULT_ROLE_SUCCESS,
    };
};

export const addSsoDefaultRoleError = (payload: $TSFixMe) => {
    return {
        type: types.ADD_SSO_DEFAULT_ROLE_FAILED,
        payload,
    };
};

export const addSsoDefaultRole = ({
    data
}: $TSFixMe) => async (dispatch: $TSFixMe) => {
    dispatch(addSsoDefaultRoleRequest());
    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await postApi(`ssoDefaultRoles/`, data);
        dispatch(addSsoDefaultRoleSuccess());
        return true;
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
        dispatch(addSsoDefaultRoleError(errorMsg));
        return false;
    }
};

export const updateSsoDefaultRoleRequest = () => {
    return {
        type: types.UPDATE_SSO_DEFAULT_ROLE_REQUEST,
    };
};

export const updateSsoDefaultRoleSuccess = () => {
    return {
        type: types.UPDATE_SSO_DEFAULT_ROLE_SUCCESS,
    };
};

export const updateSsoDefaultRoleError = (payload: $TSFixMe) => {
    return {
        type: types.UPDATE_SSO_DEFAULT_ROLE_FAILURE,
        payload,
    };
};

export const updateSsoDefaultRole = ({
    id,
    data
}: $TSFixMe) => async (dispatch: $TSFixMe) => {
    dispatch(updateSsoDefaultRoleRequest());
    try {
        await putApi(`ssoDefaultRoles/${id}`, data);
        dispatch(updateSsoDefaultRoleSuccess());
        return true;
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
        dispatch(updateSsoDefaultRoleError(errorMsg));
        return false;
    }
};

export const paginate = (type: $TSFixMe) => {
    if (type === 'next') {
        return {
            type: types.NEXT_PAGE,
        };
    } else if (type === 'prev') {
        return {
            type: types.PREV_PAGE,
        };
    }
};
