import {
    FETCH_SSO_DEFAULT_ROLES_REQUEST,
    FETCH_SSO_DEFAULT_ROLES_SUCCESS,
    FETCH_SSO_DEFAULT_ROLES_FAILURE,
    DELETE_SSO_DEFAULT_ROLE_REQUEST,
    DELETE_SSO_DEFAULT_ROLE_SUCCESS,
    DELETE_SSO_DEFAULT_ROLE_FAILED,
    ADD_SSO_DEFAULT_ROLE_REQUEST,
    ADD_SSO_DEFAULT_ROLE_SUCCESS,
    ADD_SSO_DEFAULT_ROLE_FAILED,
    FETCH_SSO_DEFAULT_ROLE_REQUEST,
    FETCH_SSO_DEFAULT_ROLE_SUCCESS,
    FETCH_SSO_DEFAULT_ROLE_FAILURE,
    UPDATE_SSO_DEFAULT_ROLE_REQUEST,
    UPDATE_SSO_DEFAULT_ROLE_SUCCESS,
    UPDATE_SSO_DEFAULT_ROLE_FAILURE,
} from '../constants/ssoDefaultRoles';

const INITIAL_STATE = {
    ssoDefaultRoles: {
        requesting: false,
        success: false,
        error: null,
        ssoDefaultRoles: [],
        count: null,
        skip: null,
        limit: null,
    },
    addSsoDefaultRole: {
        requesting: false,
        success: false,
        error: null,
    },
    deleteSsoDefaultRole: {
        requesting: false,
        success: false,
        error: null,
    },
    ssoDefaultRole: {
        requesting: false,
        success: false,
        error: null,
        ssoDefaultRole: null,
    },
    updateSsoDefaultRole: {
        requesting: false,
        success: false,
        error: null,
    },
};

export default function ssoDefaultRoles(state = INITIAL_STATE, action) {
    switch (action.type) {
        case FETCH_SSO_DEFAULT_ROLES_REQUEST:
            return Object.assign({}, state, {
                ssoDefaultRoles: {
                    requesting: true,
                    success: false,
                    error: null,
                    ssoDefaultRoles: [],
                },
            });
        case FETCH_SSO_DEFAULT_ROLES_SUCCESS:
            return Object.assign({}, state, {
                ssoDefaultRoles: {
                    requesting: false,
                    success: true,
                    error: null,
                    ssoDefaultRoles: action.payload.data,
                    count: action.payload.count,
                    skip: action.payload.skip,
                    limit: action.payload.limit,
                },
            });
        case FETCH_SSO_DEFAULT_ROLES_FAILURE:
            return Object.assign({}, state, {
                ssoDefaultRoles: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });
        case DELETE_SSO_DEFAULT_ROLE_REQUEST:
            return Object.assign({}, state, {
                deleteSsoDefaultRole: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });
        case DELETE_SSO_DEFAULT_ROLE_SUCCESS:
            return Object.assign({}, state, {
                deleteSsoDefaultRole: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                ssoDefaultRoles: {
                    ...state.ssoDefaultRoles,
                    ssoDefaultRoles: state.ssoDefaultRoles.ssoDefaultRoles.filter(
                        element => element._id !== action.payload._id
                    ),
                },
            });
        case DELETE_SSO_DEFAULT_ROLE_FAILED:
            return Object.assign({}, state, {
                deleteSsoDefaultRole: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });
        case ADD_SSO_DEFAULT_ROLE_REQUEST:
            return Object.assign({}, state, {
                addSsoDefaultRole: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });
        case ADD_SSO_DEFAULT_ROLE_SUCCESS:
            return Object.assign({}, state, {
                addSsoDefaultRole: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            });
        case ADD_SSO_DEFAULT_ROLE_FAILED:
            return Object.assign({}, state, {
                addSsoDefaultRole: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });
        case FETCH_SSO_DEFAULT_ROLE_REQUEST:
            return Object.assign({}, state, {
                ssoDefaultRoles: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });
        case FETCH_SSO_DEFAULT_ROLE_SUCCESS:
            return Object.assign({}, state, {
                ssoDefaultRoles: {
                    requesting: false,
                    success: true,
                    error: null,
                    ssoDefaultRoles: action.payload,
                },
            });
        case FETCH_SSO_DEFAULT_ROLE_FAILURE:
            return Object.assign({}, state, {
                ssoDefaultRoles: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });
        case UPDATE_SSO_DEFAULT_ROLE_REQUEST:
            return Object.assign({}, state, {
                updateSsoDefaultRole: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });
        case UPDATE_SSO_DEFAULT_ROLE_SUCCESS:
            return Object.assign({}, state, {
                updateSsoDefaultRole: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            });
        case UPDATE_SSO_DEFAULT_ROLE_FAILURE:
            return Object.assign({}, state, {
                updateSsoDefaultRole: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });
        default:
            return state;
    }
}
