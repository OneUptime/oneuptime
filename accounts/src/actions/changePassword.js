import {
	postApi
} from '../api';
import * as types from '../constants/changePassword'
import errors from '../errors'


export function changePasswordRequest(promise) {
	return {
		type: types.CHANGEPASSWORD_REQUEST,
		payload: promise
	};
}

export function changePasswordError(error) {
	return {
		type: types.CHANGEPASSWORD_FAILED,
		payload: error
	};
}

export function changePasswordSuccess(values) {

	return {
		type: types.CHANGEPASSWORD_SUCCESS,
		payload: values
	};
}

export const resetChangePassword = () => {
	return {
		type: types.RESET_CHANGEPASSWORD,
	};
};

// Calls the API to register a user.
export function changePassword(values) {
	return function (dispatch) {

		var promise = postApi('user/reset-password', values);
		dispatch(changePasswordRequest(promise));

		promise.then(function (response) {
			dispatch(changePasswordSuccess(response.data));
		}, function (error) {
			if (error && error.response && error.response.data)
				error = error.response.data;
			if (error && error.data) {
				error = error.data;
			}
			if(error && error.message){
				error = error.message;
			}
			else{
				error = 'Network Error';
			}
			dispatch(changePasswordError(errors(error)));
		});

	};
}