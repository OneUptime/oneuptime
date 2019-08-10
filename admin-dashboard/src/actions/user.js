import { getApi, putApi } from '../api';
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

export function fetchUserProjectsRequest() {
	return {
		type: types.FETCH_USER_PROJECTS_REQUEST
	};
}

export function fetchUserProjectsSuccess(users) {

	return {
		type: types.FETCH_USER_PROJECTS_SUCCESS,
		payload: users
	};
}

export function fetchUserProjectsError(error) {
	return {
		type: types.FETCH_USER_PROJECTS_FAILURE,
		payload: error
	};
}

// Calls the API to fetch all user projects.
export function fetchUserProjects(userId, skip, limit) {
	skip = skip ? parseInt(skip) : 0;
	limit = limit ? parseInt(limit) : 10;
	return function (dispatch) {
		var promise = getApi(`project/projects/user/${userId}?skip=${skip}&limit=${limit}`);
		dispatch(fetchUserProjectsRequest());
		promise.then(function (response) {
			var users = response.data;
			dispatch(fetchUserProjectsSuccess(users));

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
			dispatch(fetchUserProjectsError(errors(error)));
		});

		return promise;
	};
}
