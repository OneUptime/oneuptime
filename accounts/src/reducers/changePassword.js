import * as types from '../constants/changePassword';

// The auth reducer. The starting state sets authentication
// based on a token being in local storage. In a real app,
// we would also want a util to check if the token is expired.

const initialState = {
    requesting: false,
    error: null,
    success: false,
};

export default function register(state = initialState, action) {
    switch (action.type) {
        case types.CHANGEPASSWORD_REQUEST:
            return Object.assign({}, state, {
                requesting: true,
                error: null,
            });

        case types.CHANGEPASSWORD_SUCCESS:
            return Object.assign({}, state, {
                requesting: false,
                success: true,
                error: null,
            });

        case types.CHANGEPASSWORD_FAILED:
            return Object.assign({}, state, {
                requesting: false,
                success: false,
                error: action.payload,
            });

        case types.RESET_CHANGEPASSWORD:
            return Object.assign({}, state, initialState);

        default:
            return state;
    }
}
