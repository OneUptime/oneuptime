import {
    REQUESTING_SETTINGS,
    REQUESTING_SETTINGS_SUCCEEDED,
    REQUESTING_SETTINGS_FAILED,
    TEST_SMTP_REQUEST,
    TEST_SMTP_SUCCESS,
    TEST_SMTP_FAILURE,
    TEST_TWILIO_REQUEST,
    TEST_TWILIO_SUCCESS,
    TEST_TWILIO_FAILURE
} from '../constants/settings';

const INITIAL_STATE = {
    requesting: false,
    testing: false,
    errored: false,
    smtp: {},
    twilio: {},
    error: null,
};

export default function profileSettings(state = INITIAL_STATE, action) {
    const settings = {};
    switch (action.type) {
        case REQUESTING_SETTINGS:
            return {
                ...state,
                requesting: true,
            };

        case REQUESTING_SETTINGS_SUCCEEDED:
            if (action.payloadType === 'smtp') {
                settings.smtp = action.payload;
            } else if (action.payloadType === 'twilio') {
                settings.twilio = action.payload;
            }
            return {
                ...state,
                ...settings,
                requesting: false,
                errored: false,
            };

        case REQUESTING_SETTINGS_FAILED:
            return {
                ...state,
                requesting: false,
                errored: true,
            };

        case TEST_SMTP_REQUEST:
        case TEST_TWILIO_REQUEST:
            return {
                ...state,
                testing: true,
            };

        case TEST_SMTP_SUCCESS:
        case TEST_TWILIO_SUCCESS:
            return {
                ...state,
                errored: false,
                testing: false,
                error: null,
            };

        case TEST_SMTP_FAILURE:
        case TEST_TWILIO_FAILURE:
            return {
                ...state,
                errored: true,
                testing: false,
                error: action.payload,
            };

        default:
            return state;
    }
}
