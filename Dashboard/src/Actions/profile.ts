import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import Route from 'Common/Types/api/route';
import * as types from '../constants/profile';
import FormData from 'form-data';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import Action from 'CommonUI/src/types/action';
//Update profile setting

export const updateProfileSettingRequest = (): void => {
    return {
        type: types.UPDATE_PROFILE_SETTING_REQUEST,
    };
};

export const updateProfileSettingSuccess = (profileSetting: $TSFixMe): void => {
    return {
        type: types.UPDATE_PROFILE_SETTING_SUCCESS,
        payload: profileSetting,
    };
};

export const updateProfileSettingError = (error: ErrorPayload): void => {
    return {
        type: types.UPDATE_PROFILE_SETTING_FAILURE,
        payload: error,
    };
};

export const updatePushNotificationRequest = (): void => {
    return {
        type: types.UPDATE_PUSH_NOTIFICATION_REQUEST,
    };
};

export const updatePushNotificationError = (error: ErrorPayload): void => {
    return {
        type: types.UPDATE_PUSH_NOTIFICATION_ERROR,
        payload: error,
    };
};

export const updatePushNotificationSuccess = (data: $TSFixMe): void => {
    return {
        type: types.UPDATE_PUSH_NOTIFICATION_SUCCESS,
        payload: data,
    };
};

// Calls the API to update setting.

export const updateProfileSetting = (values: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const data = new FormData();
        if (values.profilePic && values.profilePic !== 'null') {
            if (!values.removedPic) {
                if (
                    values.profilePic &&
                    typeof values.profilePic !== 'object'
                ) {
                    data.append('profilePic', values.profilePic);
                } else {
                    data.append(
                        'profilePic',
                        values.profilePic[0],
                        values.profilePic[0].name
                    );
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

        const promise = BackendAPI.put('user/profile', data);
        dispatch(updateProfileSettingRequest());
        promise.then(
            function (response): void {
                const profileSettings = response.data;
                dispatch(updateProfileSettingSuccess(profileSettings));
                return profileSettings;
            },
            function (error): void {
                dispatch(updateProfileSettingError(error));
            }
        );

        return promise;
    };
};

// Update push notification
export const updatePushNotification = (data: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put('user/push-notification', data);
        dispatch(updatePushNotificationRequest());
        promise.then(
            function (response): void {
                const profileSettings = response.data;
                dispatch(updatePushNotificationSuccess(profileSettings));
                return profileSettings;
            },
            function (error): void {
                dispatch(updatePushNotificationError(error));
            }
        );

        return promise;
    };
};

// Update user's two factor authentication
export const twoFactorAuthTokenRequest = (): void => {
    return {
        type: types.UPDATE_TWO_FACTOR_AUTH_REQUEST,
    };
};

export const twoFactorAuthTokenSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.UPDATE_TWO_FACTOR_AUTH_SUCCESS,
        payload: payload,
    };
};

export const twoFactorAuthTokenError = (error: ErrorPayload): void => {
    return {
        type: types.UPDATE_TWO_FACTOR_AUTH_FAILURE,
        payload: error,
    };
};

export const verifyTwoFactorAuthToken = (values: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
            new Route('user/totp/verifyToken'),
            values
        );
        dispatch(twoFactorAuthTokenRequest());
        promise.then(
            function (response): void {
                const payload = response.data;
                dispatch(twoFactorAuthTokenSuccess(payload));
                return payload;
            },
            function (error): void {
                dispatch(twoFactorAuthTokenError(error));
            }
        );

        return promise;
    };
};

// Generate user's QR code
export const generateTwoFactorQRCodeRequest = (): void => {
    return {
        type: types.GENERATE_TWO_FACTOR_QR_REQUEST,
    };
};

export const generateTwoFactorQRCodeSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.GENERATE_TWO_FACTOR_QR_SUCCESS,
        payload: payload,
    };
};

export const generateTwoFactorQRCodeError = (error: ErrorPayload): void => {
    return {
        type: types.GENERATE_TWO_FACTOR_QR_FAILURE,
        payload: error,
    };
};

export const generateTwoFactorQRCode = (userId: string): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(`user/totp/token/${userId}`);
        dispatch(generateTwoFactorQRCodeRequest());
        promise.then(
            function (response): void {
                const payload = response.data;
                dispatch(generateTwoFactorQRCodeSuccess(payload));
                return payload;
            },
            function (error): void {
                dispatch(generateTwoFactorQRCodeError(error));
            }
        );

        return promise;
    };
};

// Update user twoFactorAuthToken

export const updateTwoFactorAuthToken = (data: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put('user/profile', data);
        dispatch(twoFactorAuthTokenRequest());
        promise.then(
            function (response): void {
                const payload = response.data;
                dispatch(twoFactorAuthTokenSuccess(payload));
                return payload;
            },
            function (error): void {
                dispatch(twoFactorAuthTokenError(error));
            }
        );

        return promise;
    };
};

//Update change password setting.

export const updateChangePasswordSettingRequest = (): void => {
    return {
        type: types.UPDATE_CHANGE_PASSWORD_SETTING_REQUEST,
    };
};

export const updateChangePasswordSettingSuccess = (): void => {
    return {
        type: types.UPDATE_CHANGE_PASSWORD_SETTING_SUCCESS,
    };
};

export const updateChangePasswordSettingError = (error: ErrorPayload): void => {
    return {
        type: types.UPDATE_CHANGE_PASSWORD_SETTING_FAILURE,
        payload: error,
    };
};

// Calls the API to update change password setting.
export const updateChangePasswordSetting = (data: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put('user/changePassword', data);
        dispatch(updateChangePasswordSettingRequest());

        promise.then(
            function (): void {
                dispatch(updateChangePasswordSettingSuccess());
                return {};
            },
            function (error): void {
                dispatch(updateChangePasswordSettingError(error));
            }
        );
        return promise;
    };
};

export const showProfileMenu = (position: $TSFixMe): void => {
    return {
        type: types.SHOW_PROFILE_MENU,
        payload: position,
    };
};

export const hideProfileMenu = (error: ErrorPayload): void => {
    return {
        type: types.HIDE_PROFILE_MENU,
        payload: error,
    };
};

// Get Previous User Settings.

export const userSettingsRequest = (): void => {
    return {
        type: types.USER_SETTINGS_REQUEST,
    };
};

export const userSettingsSuccess = (settings: $TSFixMe): void => {
    return {
        type: types.USER_SETTINGS_SUCCESS,
        payload: settings,
    };
};

export const userSettingsError = (error: ErrorPayload): void => {
    return {
        type: types.USER_SETTINGS_FAILURE,
        payload: error,
    };
};

// Calls the API to update on cal alert setting.
export const userSettings = (): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(new Route('user/profile'));
        dispatch(userSettingsRequest());

        promise.then(
            function (response): void {
                const settings = response.data;
                dispatch(userSettingsSuccess(settings));
                return settings;
            },
            function (error): void {
                dispatch(userSettingsError(error));
            }
        );

        return promise;
    };
};

export const logFile = (file: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({ type: 'LOG_FILE', payload: file });
    };
};

export const resetFile = (): void => {
    return function (dispatch: Dispatch): void {
        dispatch({ type: 'RESET_FILE' });
    };
};

export const sendVerificationSMSRequest = (): void => {
    return {
        type: types.SEND_VERIFICATION_SMS_REQUEST,
    };
};

export const sendVerificationSMSSuccess = (
    verificationAction: Action
): void => {
    return {
        type: types.SEND_VERIFICATION_SMS_SUCCESS,
        payload: verificationAction,
    };
};

export const sendVerificationSMSError = (error: ErrorPayload): void => {
    return {
        type: types.SEND_VERIFICATION_SMS_FAILURE,
        payload: error,
    };
};

export const sendVerificationSMSReset = (): void => {
    return function (dispatch: Dispatch): void {
        dispatch({ type: types.SEND_VERIFICATION_SMS_RESET });
    };
};

export const sendEmailVerificationRequest = (): void => {
    return {
        type: types.SEND_EMAIL_VERIFICATION_REQUEST,
    };
};

export const sendEmailVerificationSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.SEND_EMAIL_VERIFICATION_SUCCESS,
        payload,
    };
};

export const sendEmailVerificationError = (error: ErrorPayload): void => {
    return {
        type: types.SEND_EMAIL_VERIFICATION_FAILURE,
        payload: error,
    };
};

export const sendEmailVerificationLink = (values: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(new Route('user/resend'), values);
        dispatch(sendEmailVerificationRequest());

        promise.then(
            function (data): void {
                dispatch(sendEmailVerificationSuccess(data));
                return data;
            },
            function (error): void {
                dispatch(sendEmailVerificationError(error));
            }
        );
    };
};

export const sendVerificationSMS = (
    projectId: string,
    values: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
            `twilio/sms/sendVerificationToken?projectId=${projectId}`,
            values
        );
        dispatch(sendVerificationSMSRequest());

        promise.then(
            function (response): void {
                const vericationAction = response.data;
                dispatch(sendVerificationSMSSuccess(vericationAction));
                return vericationAction;
            },
            function (error): void {
                dispatch(sendVerificationSMSError(error));
            }
        );

        return promise;
    };
};
export const verifySMSCodeRequest = (): void => {
    return {
        type: types.VERIFY_SMS_CODE_REQUEST,
    };
};

export const verifySMSCodeSuccess = (verificationResult: $TSFixMe): void => {
    return {
        type: types.VERIFY_SMS_CODE_SUCCESS,
        payload: verificationResult,
    };
};

export const verifySMSCodeError = (error: ErrorPayload): void => {
    return {
        type: types.VERIFY_SMS_CODE_FAILURE,
        payload: error,
    };
};

export const verifySMSCodeReset = (): void => {
    return function (dispatch: Dispatch): void {
        dispatch({ type: types.VERIFY_SMS_CODE_RESET });
    };
};

export const verifySMSCode = (projectId: string, values: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
            `twilio/sms/verify?projectId=${projectId}`,
            values
        );
        dispatch(verifySMSCodeRequest());

        promise.then(
            function (response): void {
                const verificationResult = response.data;
                dispatch(verifySMSCodeSuccess(verificationResult));
                return verificationResult;
            },
            function (error): void {
                dispatch(verifySMSCodeError(error));
            }
        );

        return promise;
    };
};

export const setAlertPhoneNumber = (number: $TSFixMe): void => {
    return {
        type: types.SET_ALERT_PHONE_NUMBER,
        payload: number,
    };
};

export const setTwoFactorAuth = (enabled: $TSFixMe): void => {
    return {
        type: types.SET_TWO_FACTOR_AUTH,
        payload: enabled,
    };
};

export const setInitAlertEmail = (email: $TSFixMe): void => {
    return {
        type: types.SET_INIT_ALERT_EMAIL,
        payload: email,
    };
};

export const setVerified = (value: $TSFixMe): void => {
    return {
        type: types.SET_VERIFIED,
        payload: value,
    };
};

export const setInitPhoneVerificationNumber = (number: $TSFixMe): void => {
    return {
        type: types.SET_INIT_PHONE_VERIFICATION_NUMBER,
        payload: number,
    };
};

export const setInitPhoneVerification = (value: $TSFixMe): void => {
    return {
        type: types.SET_INIT_PHONE_VERIFICATION,
        payload: value,
    };
};

export const setProfilePic = (value: $TSFixMe): void => {
    return {
        type: types.SET_PROFILE_PIC,
        payload: value,
    };
};

export const setRemovedPic = (value: $TSFixMe): void => {
    return {
        type: types.SET_REMOVED_PIC,
        payload: value,
    };
};

export const setFileInputKey = (value: $TSFixMe): void => {
    return {
        type: types.SET_FILE_INPUT_KEY,
        payload: value,
    };
};

export const setIsVerified = (value: $TSFixMe): void => {
    return {
        type: types.SET_IS_VERIFIED,
        payload: value,
    };
};

export const setInitialAlertPhoneNumber = (value: $TSFixMe): void => {
    return {
        type: types.SET_INITIAL_ALERT_PHONE_NUMBER,
        payload: value,
    };
};

export const setUserEmail = (value: $TSFixMe): void => {
    return {
        type: types.SET_USER_EMAIL,
        payload: value,
    };
};

export const setResendTimer = (value: $TSFixMe): void => {
    return {
        type: types.SET_RESEND_TIMER,
        payload: value,
    };
};

// Delete user account
export const deleteAccountRequest = (): void => {
    return {
        type: types.DELETE_ACCOUNT_REQUEST,
    };
};

export const deleteAccountSuccess = (promise: $TSFixMe): void => {
    return {
        type: types.USER_SETTINGS_SUCCESS,
        payload: promise,
    };
};

export const deleteAccountFailure = (error: ErrorPayload): void => {
    return {
        type: types.USER_SETTINGS_FAILURE,
        payload: error,
    };
};

export const deleteAccount = (userId: string, confirmation: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise = delete (`user/${userId}/delete`, confirmation);
        dispatch(deleteAccountRequest());

        promise.then(
            function (response): void {
                dispatch(deleteAccountSuccess(response.data));
                return response;
            },
            function (error): void {
                dispatch(deleteAccountFailure(error));
            }
        );

        return promise;
    };
};

// Generate backup codes
const generateBackupCodesRequest = () => ({
    type: types.GENERATE_BACKUP_CODES_REQUEST,
});

const generateBackupCodesSuccess = (payload: $TSFixMe) => ({
    type: types.GENERATE_BACKUP_CODES_SUCCESS,
    payload,
});

const generateBackupCodesFailure = (payload: $TSFixMe) => ({
    type: types.GENERATE_BACKUP_CODES_FAILURE,
    payload,
});

export const generateBackupCodes = (): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(`user/generate/backupCode`);
        dispatch(generateBackupCodesRequest());

        promise.then(
            function (response): void {
                dispatch(generateBackupCodesSuccess(response.data));
                return response;
            },
            function (error): void {
                dispatch(generateBackupCodesFailure(error));
            }
        );

        return promise;
    };
};
