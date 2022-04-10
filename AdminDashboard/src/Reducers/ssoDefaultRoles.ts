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
    NEXT_PAGE,
    PREV_PAGE,
} from '../constants/ssoDefaultRoles';

import Action from 'CommonUI/src/types/action';

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
    page: 1,
};

export default function ssoDefaultRoles(state = INITIAL_STATE, action: Action) {
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
                page: action.payload.skip === 0 ? 1 : state.page,
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
                    skip: 0,
                },
                ssoDefaultRoles: {
                    ...state.ssoDefaultRoles,
                    ssoDefaultRoles:
                        state.ssoDefaultRoles.ssoDefaultRoles.filter(
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
                page: 1,
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
                ssoDefaultRole: {
                    requesting: true,
                    success: false,
                    error: null,
                    ssoDefaultRole: {},
                },
            });
        case FETCH_SSO_DEFAULT_ROLE_SUCCESS:
            return Object.assign({}, state, {
                ssoDefaultRole: {
                    requesting: false,
                    success: true,
                    error: null,
                    ssoDefaultRole: action.payload,
                },
            });
        case FETCH_SSO_DEFAULT_ROLE_FAILURE:
            return Object.assign({}, state, {
                ssoDefaultRole: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                    ssoDefaultRole: {},
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
        case NEXT_PAGE:
            return Object.assign({}, state, {
                page: state.page + 1,
            });
        case PREV_PAGE:
            return Object.assign({}, state, {
                page: state.page > 1 ? state.page - 1 : 1,
            });
        default:
            return state;
    }
}
