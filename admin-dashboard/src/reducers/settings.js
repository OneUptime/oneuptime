import {
    REQUESTING_SETTINGS,
    REQUESTING_SETTINGS_SUCCEEDED,
    REQUESTING_SETTINGS_FAILED,
} from '../constants/settings';

const INITIAL_STATE = {
    requesting: false,
    errored: false,
    smtp: {},
    twilio: {},
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

        default:
            return state;
    }
}
