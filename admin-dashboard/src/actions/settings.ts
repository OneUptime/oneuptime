import { getApi, postApi } from '../api';
import * as types from '../constants/settings';
import errors from '../errors';

export const requestingSettings = () => {
    return {
        type: types.REQUESTING_SETTINGS,
    };
};

export const requestingSettingsSucceeded = (
    payload: $TSFixMe,
    payloadType: $TSFixMe
) => {
    return {
        type: types.REQUESTING_SETTINGS_SUCCEEDED,
        payload,
        payloadType,
    };
};

export const requestingSettingsFailed = (payload: $TSFixMe) => {
    return {
        type: types.REQUESTING_SETTINGS_FAILED,
        payload,
    };
};

export const testSmtpRequest = () => ({
    type: types.TEST_SMTP_REQUEST,
});

export const testSmtpSuccess = (payload: $TSFixMe) => ({
    type: types.TEST_SMTP_SUCCESS,
    payload,
});

export const testSmtpFailure = (error: $TSFixMe) => ({
    type: types.TEST_SMTP_FAILURE,
    payload: error,
});

export const testTwilioRequest = () => ({
    type: types.TEST_TWILIO_REQUEST,
});

export const testTwilioSuccess = (payload: $TSFixMe) => ({
    type: types.TEST_TWILIO_SUCCESS,
    payload,
});

export const testTwilioFailure = (error: $TSFixMe) => ({
    type: types.TEST_TWILIO_FAILURE,
    payload: error,
});

export const testSmtp = (payload: $TSFixMe) => async (dispatch: $TSFixMe) => {
    dispatch(testSmtpRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        const response = await postApi('emailSmtp/test', payload);
        dispatch(testSmtpSuccess(response));
        return response;
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';

        dispatch(testSmtpFailure(errorMsg));
        return errorMsg;
    }
};

export const testTwilio = (payload: $TSFixMe) => async (dispatch: $TSFixMe) => {
    dispatch(testTwilioRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        const response = await postApi('twilio/sms/test', payload);
        dispatch(testTwilioSuccess(response));
        return response;
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';

        dispatch(testTwilioFailure(errorMsg));
        return errorMsg;
    }
};

export const fetchSettings = (type: $TSFixMe) => async (dispatch: $TSFixMe) => {
    dispatch(requestingSettings());
    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await getApi(`globalConfig/${type}`);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        const data = response.data || { value: {} };
        if (type === 'smtp') {
            data.value = { 'smtp-secure': false, ...data.value };
        }

        if (type === 'twilio') {
            data.value = { 'call-enabled': false, ...data.value };
        }

        if (type === 'sso') {
            data.value = { 'sso-enable': false, ...data.value };
        }
        dispatch(requestingSettingsSucceeded(data.value, type));
        return response;
    } catch (error) {
        let errorMsg;
        if (error && error.response && error.response.data)
            errorMsg = error.response.data;
        if (error && error.data) {
            errorMsg = error.data;
        }
        if (error && error.message) {
            errorMsg = error.message;
        } else {
            errorMsg = 'Network Error';
        }
        dispatch(requestingSettingsFailed(errors(errorMsg)));
    }
};

export const saveSettings = (type: $TSFixMe, settings: $TSFixMe) => async (
    dispatch: $TSFixMe
) => {
    dispatch(requestingSettings());
    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        const response = await postApi(`globalConfig`, {
            name: type,
            value: settings,
        });
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        const data = response.data || { value: {} };
        dispatch(requestingSettingsSucceeded(data.value, type));
        return response;
    } catch (error) {
        let errorMsg;
        if (error && error.response && error.response.data)
            errorMsg = error.response.data;
        if (error && error.data) {
            errorMsg = error.data;
        }
        if (error && error.message) {
            errorMsg = error.message;
        } else {
            errorMsg = 'Network Error';
        }
        dispatch(requestingSettingsFailed(errors(errorMsg)));
    }
};
