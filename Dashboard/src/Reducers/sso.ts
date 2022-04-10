import * as types from '../constants/sso';

import Action from 'CommonUI/src/types/action';

const INITIAL_STATE = {
    fetchSsos: {
        requesting: false,
        success: false,
        error: null,
        ssos: [],
        count: 0,
        skip: 0,
        limit: 10,
    },
    createSso: {
        requesting: false,
        success: false,
        error: null,
    },
    deleteSso: {
        requesting: false,
        success: false,
        error: null,
    },
    fetchSso: {
        requesting: false,
        success: false,
        error: null,
        sso: null,
    },
    updateSso: {
        requesting: false,
        success: false,
        error: null,
    },
};

export default function sso(state = INITIAL_STATE, action: Action) {
    switch (action.type) {
        case types.CREATE_SSO_REQUEST:
            return {
                ...state,
                createSso: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case types.CREATE_SSO_SUCCESS:
            return {
                ...state,
                createSso: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            };
        case types.CREATE_SSO_FAILURE:
            return {
                ...state,
                createSso: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case types.FETCH_SSOS_REQUEST:
            return {
                ...state,
                fetchSsos: {
                    ...state.fetchSsos,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case types.FETCH_SSOS_SUCCESS:
            return {
                ...state,
                fetchSsos: {
                    requesting: false,
                    success: true,
                    error: null,
                    ssos: action.payload.data,
                    count: action.payload.count,
                    skip: action.payload.skip,
                    limit: action.payload.limit,
                },
            };
        case types.FETCH_SSOS_FAILURE:
            return {
                ...state,
                fetchSsos: {
                    ...state.fetchSsos,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case types.FETCH_SSO_REQUEST:
            return {
                ...state,
                fetchSso: {
                    ...state.fetchSso,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case types.FETCH_SSO_SUCCESS:
            return {
                ...state,
                fetchSso: {
                    requesting: false,
                    success: true,
                    error: null,
                    sso: action.payload,
                },
            };
        case types.FETCH_SSO_FAILURE:
            return {
                ...state,
                fetchSso: {
                    ...state.fetchSso,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case types.UPDATE_SSO_REQUEST:
            return {
                ...state,
                updateSso: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case types.UPDATE_SSO_SUCCESS:
            return {
                ...state,
                updateSso: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            };
        case types.UPDATE_SSO_FAILURE:
            return {
                ...state,
                updateSso: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case types.DELETE_SSO_REQUEST:
            return {
                ...state,
                deleteSso: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case types.DELETE_SSO_SUCCESS:
            return {
                ...state,
                deleteSso: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            };
        case types.DELETE_SSO_FAILURE:
            return {
                ...state,
                deleteSso: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        default:
            return state;
    }
}
