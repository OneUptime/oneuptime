import { getApi, putApi, deleteApi } from '../api';
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
export function fetchUsers(skip, limit) {
	skip = skip ? parseInt(skip) : 0;
	limit = limit ? parseInt(limit) : 10;
	return function (dispatch) {
		var promise = getApi(`user/users?skip=${skip}&limit=${limit}`);
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

//Update user setting

export function updateUserSettingRequest() {
	return {
		type: types.UPDATE_USER_SETTING_REQUEST
	};
}

export function updateUserSettingSuccess(userSetting) {

	return {
		type: types.UPDATE_USER_SETTING_SUCCESS,
		payload: userSetting
	};
}

export function updateUserSettingError(error) {
	return {
		type: types.UPDATE_USER_SETTING_FAILURE,
		payload: error
	};
}

// Calls the API to update user setting.

export function updateUserSetting(values) {

	return function (dispatch) {
		let data = new FormData();
		if (values.profilePic && values.profilePic[0]) {
			data.append('profilePic', values.profilePic[0], values.profilePic[0].name);
		}

		data.append('name', values.name);
		data.append('email', values.email);
		data.append('companyPhoneNumber', values.companyPhoneNumber);
		data.append('timezone', values.timezone);

		var promise = putApi(`user/profile/${values._id}`, data);
		dispatch(updateUserSettingRequest());
		promise.then(function (response) {
			var userSettings = response.data;
			dispatch(updateUserSettingSuccess(userSettings));

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
			dispatch(updateUserSettingError(errors(error)));
		});

		return promise;
	};
}

export function logFile(file) {

	return function (dispatch) {
		dispatch({type: 'LOG_FILE', payload: file});
	};
}

export function resetFile() {

	return function (dispatch) {
		dispatch({type: 'RESET_FILE'});
	};
}

//Delete user
export function deleteUserRequest() {
	return {
		type: types.DELETE_USER_REQUEST,

	};
}

export function deleteUserReset() {
	return {
		type: types.DELETE_USER_RESET,

	};
}

export function deleteUserSuccess(user) {

	return {
		type: types.DELETE_USER_SUCCESS,
		payload: user
	};
}

export function deleteUserError(error) {
	return {
		type: types.DELETE_USER_FAILED,
		payload: error
	};
}

// Calls the API to delete a user
export function deleteUser(userId) {
	return function (dispatch) {
		var promise;
		promise = deleteApi(`user/${userId}`);
		dispatch(deleteUserRequest());
		promise.then(function (response) {
			var data = response.data;
			dispatch(deleteUserSuccess(data));
		}, function (error) {
			if (error && error.response && error.response.data)
				error = error.response.data;
			if (error && error.data) {
				error = error.data;
			}
			if (error && error.message) {
				error = error.message;
			}
			else{
				error = 'Network Error';
			}
			dispatch(deleteUserError(errors(error)));
		});
		return promise;
	};
}
