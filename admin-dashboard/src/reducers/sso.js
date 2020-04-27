import {
    FETCH_SSOS_REQUEST,
    FETCH_SSOS_SUCCESS,
    FETCH_SSOS_FAILURE,
} from '../constants/sso'

const INITIAL_STATE = {
    ssos: {
        error: null,
        requesting: false,
        success: false,
        ssos: [],
        count: null,
    }
}

export default function sso(state = INITIAL_STATE, action) {
    switch (action.type) {
        case FETCH_SSOS_REQUEST:
            return Object.assign({}, state, {
                ssos: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });
        case FETCH_SSOS_SUCCESS:
            return Object.assign({}, state, {
                ssos: {
                    requesting: false,
                    error: null,
                    success: true,
                    soss: action.payload.data,
                    count: action.payload.count,
                },
            });
        case FETCH_SSOS_FAILURE:
            return Object.assign({}, state, {
                soss: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });
        default:
            return state;
    }
}