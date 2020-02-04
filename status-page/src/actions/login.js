import { postApi } from '../api';
import errors from '../errors';
import * as types from '../constants/login';
import { User } from '../config';


export const loginRequired = () => {
	return {
		type: types.LOGIN_REQUIRED,
	};
}

export const loginRequest = (promise) => {
	return {
		type: types.LOGIN_REQUEST,
		payload: promise
	};
}

export const loginError = (error) => {
	return {
		type: types.LOGIN_FAILED,
		payload: error
	};
}

export const loginSuccess = (user) => {
	//save user session details.
	User.setUserId(user.id);
	User.setAccessToken(user.tokens.jwtAccessToken);

	return {
		type: types.LOGIN_SUCCESS,
		payload: user
	};
}

export const resetLogin = () => {
	return {
		type: types.RESET_LOGIN,
	};
};

// Calls the API to register a user.
export const loginUser = (values) => {
	return function (dispatch) {

		var promise = postApi('user/login', values);
		dispatch(loginRequest(promise));

		promise.then(function (user) {
			dispatch(loginSuccess(user.data));
		}, function (error) {
			if (error && error.response && error.response.data)
				error = error.response.data;
			if (error && error.data) {
				error = error.data;
			}
			if (error && error.message) {
				error = error.message;
			}
			if (error.length > 100) {
				error = 'Network Error';
			}
			dispatch(loginError(errors(error)));
		});
		return promise;
	};
}
