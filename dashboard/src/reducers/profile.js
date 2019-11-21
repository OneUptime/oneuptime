import * as types from '../constants/profile';

const INITIAL_STATE = {
    menuVisible: false,
    profileSetting: {
        error: null,
        requesting: false,
        success: false,
        data: {}
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
        data: {}
    },
    smsVerificationResult: {
        error: null,
        requesting: false,
        success: false,
        data: {}
    },
    emailVerificationResult: {
        error: null,
        requesting: false,
        success: false,
        data: {}
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
        initAlertEmail : '',
    },
    resendTimer: null
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
                },

            });

        case types.UPDATE_PROFILE_SETTING_SUCCESS:
            return Object.assign({}, state, {
                profileSetting: {
                    requesting: false,
                    error: null,
                    success: true,
                    data: action.payload
                },
            });

        case types.UPDATE_PROFILE_SETTING_FAILURE:

            return Object.assign({}, state, {
                profileSetting: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case types.UPDATE_PROFILE_SETTING_RESET:

            return Object.assign({}, state, {
                ...INITIAL_STATE
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
                ...INITIAL_STATE
            });

        case types.SHOW_PROFILE_MENU:

            return Object.assign({}, state, {
                menuVisible: true
            });

        case types.HIDE_PROFILE_MENU:

            return Object.assign({}, state, {
                menuVisible: false
            });

        case types.USER_SETTINGS_REQUEST:

            return Object.assign({}, state, {
                profileSetting: {
                    error: null,
                    requesting: true,
                    success: false,
                    data: {}
                }
            });

        case types.USER_SETTINGS_SUCCESS:

            return Object.assign({}, state, {
                profileSetting: {
                    error: null,
                    requesting: false,
                    success: false,
                    data: action.payload
                }
            });

        case types.USER_SETTINGS_FAILURE:

            return Object.assign({}, state, {
                profileSetting: {
                    error: action.payload,
                    requesting: false,
                    success: false,
                    data: {}
                }
            });

        case types.USER_SETTINGS_RESET:

            return Object.assign({}, state, {
                profileSetting: {
                    error: null,
                    requesting: false,
                    success: false,
                    data: {}
                }
            });

        case 'LOG_FILE':

            return Object.assign({}, state, {
                file: action.payload
            });

        case 'RESET_FILE':

            return Object.assign({}, state, {
                file: null
            });

        case types.SEND_VERIFICATION_SMS_REQUEST:

            return Object.assign({}, state, {
                smsVerification: {
                    error: null,
                    requesting: true,
                    success: false,
                    data: {}
                }
            });

        case types.SEND_VERIFICATION_SMS_SUCCESS:

            return Object.assign({}, state, {
                smsVerification: {
                    error: null,
                    requesting: false,
                    success: false,
                    data: action.payload
                }
            });

        case types.SEND_VERIFICATION_SMS_FAILURE:

            return Object.assign({}, state, {
                smsVerification: {
                    error: action.payload,
                    requesting: false,
                    success: false,
                    data: {}
                }
            });

        case types.SEND_EMAIL_VERIFICATION_REQUEST:

            return Object.assign({}, state, {
                emailVerificationResult: {
                    error: null,
                    requesting: true,
                    success: false,
                    data: {}
                }
            });

        case types.SEND_EMAIL_VERIFICATION_SUCCESS:

            return Object.assign({}, state, {
                emailVerificationResult: {
                    error: null,
                    requesting: false,
                    success: true,
                    data: action.payload
                }
            });

        case types.SEND_EMAIL_VERIFICATION_FAILURE:

            return Object.assign({}, state, {
                emailVerificationResult: {
                    error: action.payload,
                    requesting: false,
                    success: false,
                    data: {}
                }
            });

        case types.VERIFY_SMS_CODE_REQUEST:

            return Object.assign({}, state, {
                smsVerificationResult: {
                    error: null,
                    requesting: true,
                    success: false,
                    data: {}
                }
            });

        case types.VERIFY_SMS_CODE_SUCCESS:

            return Object.assign({}, state, {
                smsVerificationResult: {
                    error: null,
                    requesting: false,
                    success: false,
                    data: action.payload
                }
            });

        case types.VERIFY_SMS_CODE_FAILURE:

            return Object.assign({}, state, {
                smsVerificationResult: {
                    error: action.payload,
                    requesting: false,
                    success: false,
                    data: {}
                }
            });

        case types.SET_ALERT_PHONE_NUMBER:
            return Object.assign({}, state, {
                profileSettingState: {
                    ...state.profileSettingState,
                    alertPhoneNumber: action.payload,
                }
            });

        case types.SET_INIT_ALERT_EMAIL:
                return Object.assign({}, state, {
                    profileSettingState: {
                        ...state.profileSettingState,
                        initAlertEmail: action.payload,
                    }
                });

        case types.SET_INIT_PHONE_VERIFICATION:
            return Object.assign({}, state, {
                profileSettingState: {
                    ...state.profileSettingState,
                    initPhoneVerification: action.payload,
                }
            });

        case types.SET_VERIFIED:
            return Object.assign({}, state, {
                profileSettingState: {
                    ...state.profileSettingState,
                    verified: action.payload,
                }
            });

        case types.SET_PROFILE_PIC:
            return Object.assign({}, state, {
                profileSettingState: {
                    ...state.profileSettingState,
                    profilePic: action.payload,
                }
            });

        case types.SET_REMOVED_PIC:
            return Object.assign({}, state, {
                profileSettingState: {
                    ...state.profileSettingState,
                    removedPic: action.payload,
                }
            });

        case types.SET_FILE_INPUT_KEY:
            return Object.assign({}, state, {
                profileSettingState: {
                    ...state.profileSettingState,
                    fileInputKey: action.payload,
                }
            });

        case types.SET_IS_VERIFIED:
            return Object.assign({}, state, {
                profileSettingState: {
                    ...state.profileSettingState,
                    isVerified: action.payload,
                }
            });

        case types.SET_INITIAL_ALERT_PHONE_NUMBER:
            return Object.assign({}, state, {
                profileSettingState: {
                    ...state.profileSettingState,
                    initialAlertPhoneNumber: action.payload,
                }
            });

        case types.SET_USER_EMAIL:
            return Object.assign({}, state, {
                profileSettingState: {
                    ...state.profileSettingState,
                    userEmail: action.payload,
                }
            });

        case types.SET_INIT_PHONE_VERIFICATION_NUMBER:
            return Object.assign({}, state, {
                profileSettingState: {
                    ...state.profileSettingState,
                    initPhoneVerificationNumber: action.payload,
                }
            });

        case types.SET_RESEND_TIMER:
            return Object.assign({}, state, {
                resendTimer: action.payload
            });

        default: return state;
    }
}