import * as types from '../constants/ssoDefaultRoles';
import errors from '../errors';
import { getApi, deleteApi, postApi, putApi } from '../api';

export const fetchSsoDefaultRolesRequest = () => {
    return {
        type: types.FETCH_SSO_DEFAULT_ROLES_REQUEST,
    };
};

export const fetchSsoDefaultRolesSuccess = payload => {
    return {
        type: types.FETCH_SSO_DEFAULT_ROLES_SUCCESS,
        payload,
    };
};

export const fetchSsoDefaultRolesError = payload => {
    return {
        type: types.FETCH_SSO_DEFAULT_ROLES_FAILURE,
        payload,
    };
};

export const fetchSsoDefaultRoles = (skip, limit) => async dispatch => {
    skip = skip ? parseInt(skip) : 0;
    limit = limit ? parseInt(limit) : 10;
    dispatch(fetchSsoDefaultRolesRequest());
    try {
        const response = await getApi(
            `ssoDefaultRoles/?skip=${skip}&limit=${limit}`
        );
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

export const fetchSsoDefaultRoleSuccess = payload => {
    return {
        type: types.FETCH_SSO_DEFAULT_ROLE_SUCCESS,
        payload,
    };
};

export const fetchSsoDefaultRoleError = payload => {
    return {
        type: types.FETCH_SSO_DEFAULT_ROLE_FAILURE,
        payload,
    };
};

export const fetchSsoDefaultRole = ssoDefaultRoleId => async dispatch => {
    dispatch(fetchSsoDefaultRoleRequest());
    try {
        const response = await getApi(`ssoDefaultRoles/${ssoDefaultRoleId}`);
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

export const deleteSsoDefaultRoleSuccess = payload => {
    return {
        type: types.DELETE_SSO_DEFAULT_ROLE_SUCCESS,
        payload,
    };
};

export const deleteSsoDefaultRoleError = payload => {
    return {
        type: types.DELETE_SSO_DEFAULT_ROLE_FAILED,
        payload,
    };
};

export const deleteSsoDefaultRole = ssoId => async dispatch => {
    dispatch(deleteSsoDefaultRoleRequest());
    try {
        const response = await deleteApi(`ssoDefaultRoles/${ssoId}`);
        dispatch(deleteSsoDefaultRoleSuccess(response.data));
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

export const addSsoDefaultRoleError = payload => {
    return {
        type: types.ADD_SSO_DEFAULT_ROLE_FAILED,
        payload,
    };
};

export const addSsoDefaultRole = ({ data }) => async dispatch => {
    dispatch(addSsoDefaultRoleRequest());
    try {
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

export const updateSsoDefaultRoleError = payload => {
    return {
        type: types.UPDATE_SSO_DEFAULT_ROLE_FAILURE,
        payload,
    };
};

export const updateSsoDefaultRole = ({ id, data }) => async dispatch => {
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

export const paginate = type => {
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
