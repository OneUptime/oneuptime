import {
    FETCH_SSOS_REQUEST,
    FETCH_SSOS_SUCCESS,
    FETCH_SSOS_FAILURE,
    DELETE_SSO_REQUEST,
    DELETE_SSO_SUCCESS,
    DELETE_SSO_FAILED,
} from '../constants/sso'

const INITIAL_STATE = {
    ssos: {
        requesting: false,
        success: false,
        error: null,
        ssos: [],
        count: null,
    },
    deleteSso: {
        requesting: false,
        success: false,
        error: null,
    }
}

export default function sso(state = INITIAL_STATE, action) {
    switch (action.type) {
        case FETCH_SSOS_REQUEST:
            return Object.assign({}, state, {
                ssos: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });
        case FETCH_SSOS_SUCCESS:
            return Object.assign({}, state, {
                ssos: {
                    requesting: false,
                    success: true,
                    error: null,
                    ssos: action.payload.data,
                    count: action.payload.count,
                },
            });
        case FETCH_SSOS_FAILURE:
            return Object.assign({}, state, {
                soss: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });
        case DELETE_SSO_REQUEST:
            return Object.assign({}, state, {
                deleteSso: {
                    requesting: true,
                    success: false,
                    error: null,
                }
            })
        case DELETE_SSO_SUCCESS:
            return Object.assign({}, state, {
                deleteSso: {
                    requesting: false,
                    success: true,            
                    error: null,
                }
            })
        case DELETE_SSO_FAILED:
            return Object.assign({}, state, {
                deleteSso: {
                    requesting: false,
                    success: false,            
                    error: action.payload,
                }
            })
        default:
            return state;
    }
}