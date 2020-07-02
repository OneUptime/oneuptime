import * as types from '../constants/profile';

const INITIAL_STATE = {
    menuVisible: false,
    menuPosition: 0,
    profileSetting: {
        error: null,
        requesting: false,
        success: false,
        data: {},
    },
    changePasswordSetting: {
        error: null,
        requesting: false,
        success: false,
    },
    file: null,
    smsVerification: {
        error: null,
        requesting: false,
        success: false,
        data: {},
    },
    smsVerificationResult: {
        error: null,
        requesting: false,
        success: false,
        data: {},
    },
    emailVerificationResult: {
        error: null,
        requesting: false,
        success: false,
        data: {},
    },
    profileSettingState: {
        alertPhoneNumber: '',
        initPhoneVerification: false,
        verified: false,
        profilePic: null,
        removedPic: false,
        fileInputKey: null,
        isVerified: false,
        initialAlertPhoneNumber: '',
        userEmail: '',
        initPhoneVerificationNumber: '',
        initAlertEmail: '',
        twoFactorAuthEnabled: false,
    },
    twoFactorAuthSetting: {
        error: null,
        requesting: false,
        success: false,
        data: {},
    },
    qrCode: {
        error: null,
        requesting: false,
        success: false,
        data: {},
    },
    deleteAccount: {
        error: null,
        requesting: false,
        success: false,
        data: {},
    },
    resendTimer: null,
};

export default function profileSettings(state = INITIAL_STATE, action) {
    switch (action.type) {
        //update profile setting
        case types.UPDATE_PROFILE_SETTING_REQUEST:
            return Object.assign({}, state, {
                profileSetting: {
                    requesting: true,
                    error: null,
                    success: false,
                    data: state.profileSetting.data,
                },
            });

        case types.UPDATE_PROFILE_SETTING_SUCCESS:
            return Object.assign({}, state, {
                profileSetting: {
                    requesting: false,
                    error: null,
                    success: true,
                    data: action.payload,
                },
            });

        case types.UPDATE_PROFILE_SETTING_FAILURE:
            return Object.assign({}, state, {
                profileSetting: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    data: state.profileSetting.data,
                },
            });

        case types.UPDATE_PROFILE_SETTING_RESET:
            return Object.assign({}, state, {
                ...INITIAL_STATE,
            });

        // update change password setting.
        case types.UPDATE_CHANGE_PASSWORD_SETTING_REQUEST:
            return Object.assign({}, state, {
                changePasswordSetting: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case types.UPDATE_CHANGE_PASSWORD_SETTING_SUCCESS:
            return Object.assign({}, state, {
                changePasswordSetting: {
                    requesting: false,
                    error: null,
                    success: true,
                },
            });

        case types.UPDATE_CHANGE_PASSWORD_SETTING_FAILURE:
            return Object.assign({}, state, {
                changePasswordSetting: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case types.UPDATE_CHANGE_PASSWORD_SETTING_RESET:
            return Object.assign({}, state, {
                ...INITIAL_STATE,
            });

        case types.SHOW_PROFILE_MENU:
            return Object.assign({}, state, {
                menuVisible: true,
                menuPosition: action.payload,
            });

        case types.HIDE_PROFILE_MENU:
            return Object.assign({}, state, {
                menuVisible: false,
            });

        case types.USER_SETTINGS_REQUEST:
            return Object.assign({}, state, {
                profileSetting: {
                    ...state.profileSetting,
                    error: null,
                    requesting: true,
                    success: false,
                },
            });

        case types.USER_SETTINGS_SUCCESS:
            return Object.assign({}, state, {
                profileSetting: {
                    error: null,
                    requesting: false,
                    success: false,
                    data: action.payload,
                },
            });

        case types.USER_SETTINGS_FAILURE:
            return Object.assign({}, state, {
                profileSetting: {
                    ...state.profileSetting,
                    error: action.payload,
                    requesting: false,
                    success: false,
                },
            });

        case types.USER_SETTINGS_RESET:
            return Object.assign({}, state, {
                profileSetting: {
                    error: null,
                    requesting: false,
                    success: false,
                    data: {},
                },
            });

        case 'LOG_FILE':
            return Object.assign({}, state, {
                file: action.payload,
            });

        case 'RESET_FILE':
            return Object.assign({}, state, {
                file: null,
            });

        case types.SEND_VERIFICATION_SMS_REQUEST:
            return Object.assign({}, state, {
                smsVerification: {
                    ...state.smsVerification,
                    error: null,
                    requesting: true,
                    success: false,
                },
            });

        case types.SEND_VERIFICATION_SMS_SUCCESS:
            return Object.assign({}, state, {
                smsVerification: {
                    error: null,
                    requesting: false,
                    success: false,
                    data: action.payload,
                },
            });

        case types.SEND_VERIFICATION_SMS_FAILURE:
            return Object.assign({}, state, {
                smsVerification: {
                    ...state.smsVerification,
                    error: action.payload,
                    requesting: false,
                    success: false,
                },
            });

        case types.SEND_VERIFICATION_SMS_RESET:
            return Object.assign({}, state, {
                smsVerification: {
                    ...state.smsVerification,
                    error: null,
                    requesting: false,
                    success: false,
                },
            });

        case types.SEND_EMAIL_VERIFICATION_REQUEST:
            return Object.assign({}, state, {
                emailVerificationResult: {
                    ...state.emailVerificationResult,
                    error: null,
                    requesting: true,
                    success: false,
                },
            });

        case types.SEND_EMAIL_VERIFICATION_SUCCESS:
            return Object.assign({}, state, {
                emailVerificationResult: {
                    error: null,
                    requesting: false,
                    success: true,
                    data: action.payload,
                },
            });

        case types.SEND_EMAIL_VERIFICATION_FAILURE:
            return Object.assign({}, state, {
                emailVerificationResult: {
                    ...state.emailVerificationResult,
                    error: action.payload,
                    requesting: false,
                    success: false,
                },
            });

        case types.VERIFY_SMS_CODE_REQUEST:
            return Object.assign({}, state, {
                smsVerificationResult: {
                    ...state.smsVerificationResult,
                    error: null,
                    requesting: true,
                    success: false,
                },
            });

        case types.VERIFY_SMS_CODE_SUCCESS:
            return Object.assign({}, state, {
                smsVerificationResult: {
                    error: null,
                    requesting: false,
                    success: false,
                    data: action.payload,
                },
            });

        case types.VERIFY_SMS_CODE_FAILURE:
            return Object.assign({}, state, {
                smsVerificationResult: {
                    ...state.smsVerificationResult,
                    error: action.payload,
                    requesting: false,
                    success: false,
                },
            });

        case types.VERIFY_SMS_CODE_RESET:
            return Object.assign({}, state, {
                smsVerificationResult: {
                    ...state.smsVerificationResult,
                    error: null,
                    requesting: false,
                    success: false,
                },
            });

        case types.SET_ALERT_PHONE_NUMBER:
            return Object.assign({}, state, {
                profileSettingState: {
                    ...state.profileSettingState,
                    alertPhoneNumber: action.payload,
                },
            });

        case types.SET_TWO_FACTOR_AUTH:
            return Object.assign({}, state, {
                profileSettingState: {
                    ...state.profileSettingState,
                    twoFactorAuthEnabled: action.payload,
                },
            });

        //update user's two factor auth settings
        case types.UPDATE_TWO_FACTOR_AUTH_REQUEST:
            return Object.assign({}, state, {
                twoFactorAuthSetting: {
                    requesting: true,
                    error: null,
                    success: false,
                    data: state.twoFactorAuthSetting.data,
                },
            });

        case types.UPDATE_TWO_FACTOR_AUTH_SUCCESS:
            return Object.assign({}, state, {
                profileSetting: {
                    ...INITIAL_STATE.profileSetting,
                    data: action.payload,
                },
                twoFactorAuthSetting: {
                    requesting: false,
                    error: null,
                    success: false,
                    data: state.twoFactorAuthSetting.data,
                },
            });

        case types.UPDATE_TWO_FACTOR_AUTH_FAILURE:
            return Object.assign({}, state, {
                twoFactorAuthSetting: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    data: state.twoFactorAuthSetting.data,
                },
            });

        case types.UPDATE_TWO_FACTOR_AUTH_RESET:
            return Object.assign({}, state, {
                ...INITIAL_STATE,
            });

        //generate user's QR code
        case types.GENERATE_TWO_FACTOR_QR_REQUEST:
            return Object.assign({}, state, {
                qrCode: {
                    requesting: true,
                    error: null,
                    success: false,
                    data: state.qrCode.data,
                },
            });

        case types.GENERATE_TWO_FACTOR_QR_SUCCESS:
            return Object.assign({}, state, {
                qrCode: {
                    requesting: false,
                    error: null,
                    success: false,
                    data: action.payload,
                },
            });

        case types.GENERATE_TWO_FACTOR_QR_FAILURE:
            return Object.assign({}, state, {
                qrCode: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    data: state.qrCode.data,
                },
            });

        case types.GENERATE_TWO_FACTOR_QR_RESET:
            return Object.assign({}, state, {
                ...INITIAL_STATE,
            });

        case types.SET_INIT_ALERT_EMAIL:
            return Object.assign({}, state, {
                profileSettingState: {
                    ...state.profileSettingState,
                    initAlertEmail: action.payload,
                },
            });

        case types.SET_INIT_PHONE_VERIFICATION:
            return Object.assign({}, state, {
                profileSettingState: {
                    ...state.profileSettingState,
                    initPhoneVerification: action.payload,
                },
            });

        case types.SET_VERIFIED:
            return Object.assign({}, state, {
                profileSettingState: {
                    ...state.profileSettingState,
                    verified: action.payload,
                },
            });

        case types.SET_PROFILE_PIC:
            return Object.assign({}, state, {
                profileSettingState: {
                    ...state.profileSettingState,
                    profilePic: action.payload,
                },
            });

        case types.SET_REMOVED_PIC:
            return Object.assign({}, state, {
                profileSettingState: {
                    ...state.profileSettingState,
                    removedPic: action.payload,
                },
            });

        case types.SET_FILE_INPUT_KEY:
            return Object.assign({}, state, {
                profileSettingState: {
                    ...state.profileSettingState,
                    fileInputKey: action.payload,
                },
            });

        case types.SET_IS_VERIFIED:
            return Object.assign({}, state, {
                profileSettingState: {
                    ...state.profileSettingState,
                    isVerified: action.payload,
                },
            });

        case types.SET_INITIAL_ALERT_PHONE_NUMBER:
            return Object.assign({}, state, {
                profileSettingState: {
                    ...state.profileSettingState,
                    initialAlertPhoneNumber: action.payload,
                },
            });

        case types.SET_USER_EMAIL:
            return Object.assign({}, state, {
                profileSettingState: {
                    ...state.profileSettingState,
                    userEmail: action.payload,
                },
            });

        case types.SET_INIT_PHONE_VERIFICATION_NUMBER:
            return Object.assign({}, state, {
                profileSettingState: {
                    ...state.profileSettingState,
                    initPhoneVerificationNumber: action.payload,
                },
            });

        case types.SET_RESEND_TIMER:
            return Object.assign({}, state, {
                resendTimer: action.payload,
            });

        case types.DELETE_ACCOUNT_REQUEST:
            return Object.assign({}, state, {
                deleteAccount: {
                    requesting: true,
                    error: null,
                    success: false,
                    data: {},
                },
            });

        case types.DELETE_ACCOUNT_SUCCESS:
            return Object.assign({}, state, {
                deleteAccount: {
                    requesting: false,
                    error: null,
                    success: true,
                    data: action.payload,
                },
            });

        case types.DELETE_ACCOUNT_FAILURE:
            return Object.assign({}, state, {
                deleteAccount: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    data: {},
                },
            });

        default:
            return state;
    }
}
