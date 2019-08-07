import { getApi } from '../api';
import * as types from '../constants/user';
import errors from '../errors'

export function fetchUsersRequest() {
	return {
		type: types.FETCH_USERS_REQUEST
	};
}

export function fetchUsersSuccess(users) {

	return {
		type: types.FETCH_USERS_SUCCESS,
		payload: users
	};
}

export function fetchUsersError(error) {
	return {
		type: types.FETCH_USERS_FAILURE,
		payload: error
	};
}

// Calls the API to fetch all users.
export function fetchUsers() {
	return function (dispatch) {
		var promise = getApi('user/users');
		dispatch(fetchUsersRequest());
		promise.then(function (response) {
			var users = response.data;
			dispatch(fetchUsersSuccess(users));

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
			dispatch(fetchUsersError(errors(error)));
		});

		return promise;
	};
}
