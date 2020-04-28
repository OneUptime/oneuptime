import {
    FETCH_SSOS_REQUEST,
    FETCH_SSOS_SUCCESS,
    FETCH_SSOS_FAILURE,
    DELETE_SSO_REQUEST,
    DELETE_SSO_SUCCESS,
    DELETE_SSO_FAILED,
    ADD_SSO_REQUEST,
    ADD_SSO_SUCCESS,
    ADD_SSO_FAILED,
    FETCH_SSO_REQUEST,
    FETCH_SSO_SUCCESS,
    FETCH_SSO_FAILURE,
    UPDATE_SSO_REQUEST,
    UPDATE_SSO_SUCCESS,
    UPDATE_SSO_FAILURE,
} from '../constants/sso'

const INITIAL_STATE = {
    ssos: {
        requesting: false,
        success: false,
        error: null,
        ssos: [],
        count: null,
        skip: null,
        limit: null,
    },
    addSso: {
        requesting: false,
        success: false,
        error: null,
    },
    deleteSso: {
        requesting: false,
        success: false,
        error: null,
    },
    sso: {
        requesting: false,
        success: false,
        error: null,
        sso: null,
    },
    updateSso: {
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
                    ssos: [],
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
                    skip: action.payload.skip,
                    limit: action.payload.limit,
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
        case ADD_SSO_REQUEST:
            return Object.assign({}, state, {
                addSso: {
                    requesting: true,
                    success: false,
                    error: null,
                }
            })
        case ADD_SSO_SUCCESS:
            return Object.assign({}, state, {
                addSso: {
                    requesting: false,
                    success: true,
                    error: null,
                }
            })
        case ADD_SSO_FAILED:
            return Object.assign({}, state, {
                addSso: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            })
        case FETCH_SSO_REQUEST:
            return Object.assign({}, state, {
                sso: {
                    requesting: true,
                    success: false,
                    error: null,
                }
            })
        case FETCH_SSO_SUCCESS:
            return Object.assign({}, state, {
                sso: {
                    requesting: false,
                    success: true,
                    error: null,
                    sso: action.payload
                }
            })
        case FETCH_SSO_FAILURE:
            return Object.assign({}, state, {
                sso: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            })
        case UPDATE_SSO_REQUEST:
            return Object.assign({}, state, {
                updateSso: {
                    requesting: true,
                    success: false,
                    error: null,
                }
            })
        case UPDATE_SSO_SUCCESS:
            return Object.assign({}, state, {
                updateSso: {
                    requesting: false,
                    success: true,
                    error: null,
                }
            })
        case UPDATE_SSO_FAILURE:
            return Object.assign({}, state, {
                updateSso: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            })
        default:
            return state;
    }
}