import { getApi ,putApi} from '../api';
import * as types from '../constants/profile';
import FormData from 'form-data';
import errors from '../errors'

//Update profile setting

export function updateProfileSettingRequest() {
	return {
		type: types.UPDATE_PROFILE_SETTING_REQUEST
	};
}

export function updateProfileSettingSuccess(profileSetting) {

	return {
		type: types.UPDATE_PROFILE_SETTING_SUCCESS,
		payload: profileSetting
	};
}

export function updateProfileSettingError(error) {
	return {
		type: types.UPDATE_PROFILE_SETTING_FAILURE,
		payload: error
	};
}

// Calls the API to update setting.

export function updateProfileSetting(values) {

	return function (dispatch) {
		let data = new FormData();
		if (values.profilePic && values.profilePic[0]) {
			data.append('profilePic', values.profilePic[0], values.profilePic[0].name);
		}

		data.append('name', values.name);
		data.append('email', values.email);
		data.append('companyPhoneNumber', values.companyPhoneNumber);
		data.append('timezone', values.timezone);

		var promise = putApi('user/profile', data);
		dispatch(updateProfileSettingRequest());
		promise.then(function (response) {
			var profileSettings = response.data;
			dispatch(updateProfileSettingSuccess(profileSettings));

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
			dispatch(updateProfileSettingError(errors(error)));
		});

		return promise;
	};
}

//Update change password setting.

export function updateChangePasswordSettingRequest() {
	return {
		type: types.UPDATE_CHANGE_PASSWORD_SETTING_REQUEST,

	};
}

export function updateChangePasswordSettingSuccess() {

	return {
		type: types.UPDATE_CHANGE_PASSWORD_SETTING_SUCCESS,
	};
}

export function updateChangePasswordSettingError(error) {
	return {
		type: types.UPDATE_CHANGE_PASSWORD_SETTING_FAILURE,
		payload: error
	};
}

// Calls the API to update change password setting.
export function updateChangePasswordSetting(data) {

	return function (dispatch) {

		var promise = putApi('user/changePassword', data);
		dispatch(updateChangePasswordSettingRequest());

		promise.then(function () {

			dispatch(updateChangePasswordSettingSuccess());
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
			dispatch(updateChangePasswordSettingError(errors(error)));
		});
		return promise;
	};
}



export function showProfileMenu() {

	return {
		type: types.SHOW_PROFILE_MENU,
	};
}

export function hideProfileMenu(error) {
	return {
		type: types.HIDE_PROFILE_MENU,
		payload: error
	};
}


// Get Previous User Settings.

export function userSettingsRequest() {
	return {
		type: types.USER_SETTINGS_REQUEST,
	};
}

export function userSettingsSuccess(settings) {

	return {
		type: types.USER_SETTINGS_SUCCESS,
		payload: settings
	};
}

export function userSettingsError(error) {
	return {
		type: types.USER_SETTINGS_FAILURE,
		payload: error
	};
}

// Calls the API to update on cal alert setting.
export function userSettings() {

	return function (dispatch) {

		var promise = getApi('user/profile');
		dispatch(userSettingsRequest());

		promise.then(function (response) {
			var settings = response.data;
			dispatch(userSettingsSuccess(settings));
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
			dispatch(userSettingsError(errors(error)));
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
