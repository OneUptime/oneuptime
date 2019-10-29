import {
	SIGNUP_SUCCESS,
	SIGNUP_FAILED,
	SIGNUP_STEP_INC,
	SIGNUP_STEP_DEC,
	SIGNUP_REQUEST,
	RESET_SIGNUP,
	SAVE_CARD_STATE,
	SAVE_USER_STATE,
	SAVE_COMPANY_STATE,
	IS_USER_INVITED_FAILED,
	IS_USER_INVITED_REQUEST,
	IS_USER_INVITED_RESET,
	IS_USER_INVITED_SUCCESS,
	SKIP_CARD_STEP
} from '../constants/register.js'


// The register state reducer.
const initialState = {
	requesting: false,
	step: 1,
	user: {},
	card: {},
	company: {},
	error: null,
	success: false,
	isUserInvited: {
		requesting: false,
		isUserInvited: null,
		error: null,
		success: false
	}
};

export default function register(state = initialState, action) {
	let incCount,decCount,stage;
	switch (action.type) {
		case SIGNUP_REQUEST:
			return Object.assign({}, state, {
				requesting: true,
				error: null
			});
		case SIGNUP_SUCCESS:
			return Object.assign({}, state, {
				requesting: false,
				success: true,
				error: null,
			});
		case SIGNUP_FAILED:

			return Object.assign({}, state, {
				requesting: false,
				isAuthenticated: false,
				error: action.payload,
                isUserInvited : {
					...state.isUserInvited,
					requesting: false,
				}
			});

		case SIGNUP_STEP_INC:
			incCount = state.step + 1;

			return Object.assign({}, state, {
				step: incCount,
				error: null
			});

		case SKIP_CARD_STEP:
			stage = 3;

			return Object.assign({}, state, {
				step: stage,
				error: null
			});

		case SIGNUP_STEP_DEC:
			decCount = state.step - 1;

			return Object.assign({}, state, {
				step: decCount,
				error: null
			});
		case SAVE_USER_STATE:

			return Object.assign({}, state, {
				user: action.payload
			});
		case SAVE_CARD_STATE:

			return Object.assign({}, state, {
				card: action.payload
			});
		case SAVE_COMPANY_STATE:

			return Object.assign({}, state, {
				company: action.payload
			});

		case RESET_SIGNUP:
			return Object.assign({}, state, initialState);

		case IS_USER_INVITED_FAILED:

			return Object.assign({}, state, {
				isUserInvited: {
					requesting: false,
					isUserInvited: null,
					error: action.payload,
					success: false
				}
			});
		case IS_USER_INVITED_REQUEST:

			return Object.assign({}, state, {
				isUserInvited: {
					requesting: true,
					isUserInvited: null,
					error: null,
					success: false
				}
			});

		case IS_USER_INVITED_SUCCESS:
			return Object.assign({}, state, {
				...state, isUserInvited: {
					requesting: false,
					isUserInvited: action.payload,
					error: null,
					success: false
				}
			});

		case IS_USER_INVITED_RESET:
			return Object.assign({}, state, {
				...state, isUserInvited: {
					requesting: false,
					isUserInvited: null,
					error: null,
					success: false
				}
			});

		default:
			return state;
	}
}
