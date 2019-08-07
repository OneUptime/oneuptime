import {
    FETCH_USERS_REQUEST,
    FETCH_USERS_SUCCESS,
    FETCH_USERS_FAILURE,
    FETCH_USERS_RESET,
} from '../constants/user';

const INITIAL_STATE = {
    users: {
        error: null,
        requesting: false,
        success: false,
        users: [],
        count: null,
        limit: null,
        skip: null
    }
};

export default function user(state = INITIAL_STATE, action) {

    switch (action.type) {

        // fetch users list
        case FETCH_USERS_REQUEST:

            return Object.assign({}, state, {
                users: {
                    requesting: true,
                    error: null,
                    success: false,
                },

            });

        case FETCH_USERS_SUCCESS:
            return Object.assign({}, state, {
                users: {
                    requesting: false,
                    error: null,
                    success: true,
                    users: action.payload.data,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip
                },
            });

        case FETCH_USERS_FAILURE:

            return Object.assign({}, state, {
                users: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case FETCH_USERS_RESET:

            return Object.assign({}, state, {
                ...INITIAL_STATE
            });

        default: return state;
    }
}
