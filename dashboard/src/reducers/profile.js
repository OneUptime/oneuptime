import {
    UPDATE_PROFILE_SETTING_REQUEST,
    UPDATE_PROFILE_SETTING_SUCCESS,
    UPDATE_PROFILE_SETTING_FAILURE,
    UPDATE_PROFILE_SETTING_RESET,
    UPDATE_CHANGE_PASSWORD_SETTING_REQUEST,
    UPDATE_CHANGE_PASSWORD_SETTING_SUCCESS,
    UPDATE_CHANGE_PASSWORD_SETTING_FAILURE,
    UPDATE_CHANGE_PASSWORD_SETTING_RESET,
    USER_SETTINGS_REQUEST,
    USER_SETTINGS_SUCCESS,
    USER_SETTINGS_FAILURE,
    USER_SETTINGS_RESET,
    SHOW_PROFILE_MENU,
    HIDE_PROFILE_MENU,
    SEND_VERIFICATION_SMS_REQUEST,
    SEND_VERIFICATION_SMS_SUCCESS,
    SEND_VERIFICATION_SMS_FAILURE,
    VERIFY_SMS_CODE_REQUEST,
    VERIFY_SMS_CODE_SUCCESS,
    VERIFY_SMS_CODE_FAILURE
} from '../constants/profile';

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
    }
};

export default function profileSettings(state = INITIAL_STATE, action) {

    switch (action.type) {

        //update profile setting
        case UPDATE_PROFILE_SETTING_REQUEST:

            return Object.assign({}, state, {
                profileSetting: {
                    requesting: true,
                    error: null,
                    success: false,
                },

            });

        case UPDATE_PROFILE_SETTING_SUCCESS:
            return Object.assign({}, state, {
                profileSetting: {
                    requesting: false,
                    error: null,
                    success: true,
                    data: action.payload
                },
            });

        case UPDATE_PROFILE_SETTING_FAILURE:

            return Object.assign({}, state, {
                profileSetting: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case UPDATE_PROFILE_SETTING_RESET:

            return Object.assign({}, state, {
                ...INITIAL_STATE
            });

        // update change password setting.
        case UPDATE_CHANGE_PASSWORD_SETTING_REQUEST:
            return Object.assign({}, state, {
                changePasswordSetting: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case UPDATE_CHANGE_PASSWORD_SETTING_SUCCESS:

            return Object.assign({}, state, {
                changePasswordSetting: {
                    requesting: false,
                    error: null,
                    success: true,
                },
            });

        case UPDATE_CHANGE_PASSWORD_SETTING_FAILURE:

            return Object.assign({}, state, {
                changePasswordSetting: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case UPDATE_CHANGE_PASSWORD_SETTING_RESET:

            return Object.assign({}, state, {
                ...INITIAL_STATE
            });

        case SHOW_PROFILE_MENU:

            return Object.assign({}, state, {
                menuVisible: true
            });

        case HIDE_PROFILE_MENU:

            return Object.assign({}, state, {
                menuVisible: false
            });

        case USER_SETTINGS_REQUEST:
        
            return Object.assign({}, state, {
                profileSetting: {
                    error: null,
                    requesting: true,
                    success: false,
                    data: {}
                }
            });

        case USER_SETTINGS_SUCCESS:

            return Object.assign({}, state, {
                profileSetting: {
                    error: null,
                    requesting: false,
                    success: false,
                    data: action.payload
                }
            });

        case USER_SETTINGS_FAILURE:

            return Object.assign({}, state, {
                profileSetting: {
                    error: action.payload,
                    requesting: false,
                    success: false,
                    data: {}
                }
            });

        case USER_SETTINGS_RESET:

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

        case SEND_VERIFICATION_SMS_REQUEST:

            return Object.assign({}, state, {
                smsVerification: {
                    error: null,
                    requesting: true,
                    success: false,
                    data: {}
                }
            });

        case SEND_VERIFICATION_SMS_SUCCESS:

            return Object.assign({}, state, {
                smsVerification: {
                    error: null,
                    requesting: false,
                    success: false,
                    data: action.payload
                }
            });

        case SEND_VERIFICATION_SMS_FAILURE:

            return Object.assign({}, state, {
                smsVerification: {
                    error: action.payload,
                    requesting: false,
                    success: false,
                    data: {}
                }
            });
        case VERIFY_SMS_CODE_REQUEST:

            return Object.assign({}, state, {
                smsVerificationResult: {
                    error: null,
                    requesting: true,
                    success: false,
                    data: {}
                }
            });

        case VERIFY_SMS_CODE_SUCCESS:

            return Object.assign({}, state, {
                smsVerificationResult: {
                    error: null,
                    requesting: false,
                    success: false,
                    data: action.payload
                }
            });

        case VERIFY_SMS_CODE_FAILURE:

            return Object.assign({}, state, {
                smsVerificationResult: {
                    error: action.payload,
                    requesting: false,
                    success: false,
                    data: {}
                }
            });

        default: return state;
    }
}
