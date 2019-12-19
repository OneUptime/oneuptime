import {LOGIN_REQUEST,LOGIN_SUCCESS, LOGIN_FAILED, RESET_LOGIN, SAVE_STATUS_PAGE } from '../constants/login';


// The auth reducer. The starting state sets authentication
// based on a token being in local storage. In a real app,
// we would also want a util to check if the token is expired.

const initialState = {
	requesting: false,
	user: {},
	error: null,
	success: false,
	statusPageLogin: false,
	statusPageURL: null
};


export default function register(state = initialState, action) {
	switch (action.type) {

		case LOGIN_REQUEST:
			return Object.assign({}, state, {
				requesting: true,
				error: null
			});
		case LOGIN_SUCCESS:
			return Object.assign({}, state, {
				requesting: false,
				success: true,
				error: null,
			});
		case LOGIN_FAILED:

			return Object.assign({}, state, {
				requesting: false,
				success:false,
				error: action.payload,
			});

		case RESET_LOGIN:
			return Object.assign({}, state, initialState);

		case SAVE_STATUS_PAGE:
			return Object.assign({}, state, {
				statusPageLogin: action.payload.statusPageLogin,
				statusPageURL: action.payload.statusPageURL
			})

		default:
			return state;
	}
}
