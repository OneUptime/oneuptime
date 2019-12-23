import { getApi, putApi, postApi } from '../api';
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
		if (values.profilePic && values.profilePic !== 'null') {
			if (!values.removedPic) {
				if (values.profilePic && typeof values.profilePic !== 'object') {
					data.append('profilePic', values.profilePic);
				}
				else {
					data.append('profilePic', values.profilePic[0], values.profilePic[0].name);
				}
			} else {
				data.append('profilePic', null);
			}
		}

		data.append('name', values.name);
		data.append('email', values.email);
		data.append('companyPhoneNumber', values.companyPhoneNumber);
		data.append('timezone', values.timezone);
		data.append('alertPhoneNumber', values.alertPhoneNumber);

		var promise = putApi('user/profile', data);
		dispatch(updateProfileSettingRequest());
		promise.then(function (response) {
			var profileSettings = response.data;
			dispatch(updateProfileSettingSuccess(profileSettings));
			return profileSettings;
		}, function (error) {

			if (error && error.response && error.response.data)
				error = error.response.data;
			if (error && error.data) {
				error = error.data;
			}
			if (error && error.message) {
				error = error.message;
			}
			else {
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
			return {};
		}, function (error) {

			if (error && error.response && error.response.data)
				error = error.response.data;
			if (error && error.data) {
				error = error.data;
			}
			if (error && error.message) {
				error = error.message;
			}
			else {
				error = 'Network Error';
			}
			dispatch(updateChangePasswordSettingError(errors(error)));
		});
		return promise;
	};
}



export function showProfileMenu(position) {

	return {
		type: types.SHOW_PROFILE_MENU,
		payload: position
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
			return settings;
		}, function (error) {
			if (error && error.response && error.response.data)
				error = error.response.data;
			if (error && error.data) {
				error = error.data;
			}
			if (error && error.message) {
				error = error.message;
			}
			else {
				error = 'Network Error';
			}
			dispatch(userSettingsError(errors(error)));
		});

		return promise;
	};
}

export function logFile(file) {

	return function (dispatch) {
		dispatch({ type: 'LOG_FILE', payload: file });
	};
}

export function resetFile() {

	return function (dispatch) {
		dispatch({ type: 'RESET_FILE' });
	};
}


export function sendVerificationSMSRequest() {
	return {
		type: types.SEND_VERIFICATION_SMS_REQUEST,
	};
}

export function sendVerificationSMSSuccess(verificationAction) {

	return {
		type: types.SEND_VERIFICATION_SMS_SUCCESS,
		payload: verificationAction
	};
}

export function sendVerificationSMSError(error) {
	return {
		type: types.SEND_VERIFICATION_SMS_FAILURE,
		payload: error
	};
}

export function sendVerificationSMSReset() {

	return function (dispatch) {
		dispatch({ type: types.SEND_VERIFICATION_SMS_RESET });
	};
}

export function sendEmailVerificationRequest() {
	return {
		type: types.SEND_EMAIL_VERIFICATION_REQUEST,
	};
}

export function sendEmailVerificationSuccess(payload) {
	return {
		type: types.SEND_EMAIL_VERIFICATION_SUCCESS,
		payload
	};
}

export function sendEmailVerificationError(error) {
	return {
		type: types.SEND_EMAIL_VERIFICATION_FAILURE,
		payload: error
	};
}

export function sendEmailVerificationLink(values) {
	return function (dispatch) {

		var promise = postApi('user/resend', values);
		dispatch(sendEmailVerificationRequest());

		promise.then(function (data) {
			dispatch(sendEmailVerificationSuccess(data));
			return data;
		}, function (error) {
			if (error && error.response && error.response.data)
				error = error.response.data;
			if (error && error.data) {
				error = error.data;
			}
			if (error && error.message) {
				error = error.message;
			}
			else {
				error = 'Network Error';
			}
			dispatch(sendEmailVerificationError(errors(error)));
		});

	};
}

export function sendVerificationSMS(projectId, values) {

	return function (dispatch) {

		var promise = postApi(`twilio/sms/sendVerificationToken?projectId=${projectId}`, values);
		dispatch(sendVerificationSMSRequest());

		promise.then(function (response) {
			var vericationAction = response.data;
			dispatch(sendVerificationSMSSuccess(vericationAction));
			return vericationAction;
		}, function (error) {
			if (error && error.response && error.response.data)
				error = error.response.data;
			if (error && error.data) {
				error = error.data;
			}
			if (error && error.message) {
				error = error.message;
			}
			else {
				error = 'Network Error';
			}
			dispatch(sendVerificationSMSError(errors(error)));
		});

		return promise;
	};
}
export function verifySMSCodeRequest() {
	return {
		type: types.VERIFY_SMS_CODE_REQUEST,
	};
}

export function verifySMSCodeSuccess(verificationResult) {

	return {
		type: types.VERIFY_SMS_CODE_SUCCESS,
		payload: verificationResult
	};
}

export function verifySMSCodeError(error) {
	return {
		type: types.VERIFY_SMS_CODE_FAILURE,
		payload: error
	};
}

export function verifySMSCodeReset() {

	return function (dispatch) {
		dispatch({ type: types.VERIFY_SMS_CODE_RESET });
	};
}

export function verifySMSCode(projectId, values) {

	return function (dispatch) {

		var promise = postApi(`twilio/sms/verify?projectId=${projectId}`, values);
		dispatch(verifySMSCodeRequest());

		promise.then(function (response) {
			var verificationResult = response.data;
			dispatch(verifySMSCodeSuccess(verificationResult));
			return verificationResult;
		}, function (error) {
			if (error && error.response && error.response.data)
				error = error.response.data;
			if (error && error.data) {
				error = error.data;
			}
			if (error && error.message) {
				error = error.message;
			}
			else {
				error = 'Network Error';
			}
			dispatch(verifySMSCodeError(errors(error)));
		});

		return promise;
	};
}

export function setAlertPhoneNumber(number) {
	return {
		type: types.SET_ALERT_PHONE_NUMBER,
		payload: number
	};
}

export function setInitAlertEmail(email) {
	return {
		type: types.SET_INIT_ALERT_EMAIL,
		payload: email
	};
}

export function setVerified(value) {
	return {
		type: types.SET_VERIFIED,
		payload: value
	};
}

export function setInitPhoneVerificationNumber(number) {
	return {
		type: types.SET_INIT_PHONE_VERIFICATION_NUMBER,
		payload: number
	};
}

export function setInitPhoneVerification(value) {
	return {
		type: types.SET_INIT_PHONE_VERIFICATION,
		payload: value
	};
}

export function setProfilePic(value) {
	return {
		type: types.SET_PROFILE_PIC,
		payload: value
	};
}

export function setRemovedPic(value) {
	return {
		type: types.SET_REMOVED_PIC,
		payload: value
	};
}

export function setFileInputKey(value) {
	return {
		type: types.SET_FILE_INPUT_KEY,
		payload: value
	};
}

export function setIsVerified(value) {
	return {
		type: types.SET_IS_VERIFIED,
		payload: value
	};
}

export function setInitialAlertPhoneNumber(value) {
	return {
		type: types.SET_INITIAL_ALERT_PHONE_NUMBER,
		payload: value
	};
}

export function setUserEmail(value) {
	return {
		type: types.SET_USER_EMAIL,
		payload: value
	};
}

export function setResendTimer(value) {
	return {
		type: types.SET_RESEND_TIMER,
		payload: value
	};
}