import {
    FETCH_TUTORIAL_REQUEST,
    FETCH_TUTORIAL_SUCCESS,
    FETCH_TUTORIAL_FAILURE,
    FETCH_TUTORIAL_RESET,
    CLOSE_TUTORIAL_REQUEST,
    CLOSE_TUTORIAL_SUCCESS,
    CLOSE_TUTORIAL_FAILURE,
    CLOSE_TUTORIAL_RESET
} from '../constants/tutorial';

const initialState = {
    error: null,
    requesting: false,
    success: false,
    monitor: {
        show: true
    },
    incident: {
        show: true
    },
    statusPage: {
        show: true
    },
    callSchedule: {
        show: true
    }
};

export default (state = initialState, action) => {
    switch (action.type) {
        case FETCH_TUTORIAL_REQUEST:
            return Object.assign({}, state, {
                ...state,
                error: null,
                requesting: true,
                success: false,
            });

        case FETCH_TUTORIAL_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                error: null,
                requesting: false,
                success: true,
                ...action.payload.data
            });

        case FETCH_TUTORIAL_FAILURE:
            return Object.assign({}, state, {
                ...state,
                error: action.payload,
                requesting: false,
                success: false,
            });

        case FETCH_TUTORIAL_RESET:
            return Object.assign({}, state, {
                error: null,
                requesting: false,
                success: false,
                monitor: {
                    show: true
                },
                incident: {
                    show: true
                },
                statusPage: {
                    show: true
                },
                callSchedule: {
                    show: true
                }
            });

        case CLOSE_TUTORIAL_REQUEST:
            return Object.assign({}, state, {
                ...state,
                error: null,
                requesting: true,
                success: false,
            });

        case CLOSE_TUTORIAL_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                error: null,
                requesting: false,
                success: true,
                ...action.payload.data
            });

        case CLOSE_TUTORIAL_FAILURE:
            return Object.assign({}, state, {
                ...state,
                error: action.payload,
                requesting: false,
                success: false,
            });

        case CLOSE_TUTORIAL_RESET:
            return Object.assign({}, state, {
                ...state,
                error: null,
                requesting: false,
                success: false,
            });

        default: return state;
    };
};