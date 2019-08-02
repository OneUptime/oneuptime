import * as types from '../constants/validateToken';


/*
 * The auth reducer. The starting state sets authentication
 * based on a token being in local storage. In a real app,
 * we would also want a util to check if the token is expired.
 */

const initialState = {
	requesting: false,
	user: {},
	error: null,
	success: false
};


export default function register(state = initialState, action) {
	switch (action.type) {

		case types.VALIDATE_TOKEN_REQUEST:
			return Object.assign({}, state, {
				requesting: true,
				error: null
			});
		case types.VALIDATE_TOKEN_SUCCESS:
			return Object.assign({}, state, {
				requesting: false,
				success: true,
				error: null
			});
		case types.VALIDATE_TOKEN_FAILED:
			return Object.assign({}, state, {
				requesting: false,
				success:false,
				error: action.payload
			});

		case types.RESET_VALIDATE_TOKEN:
			return Object.assign({}, state, initialState);

		default:
			return state;
	}
}