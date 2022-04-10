import BackendAPI from 'Common-ui/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/settings';
import Route from 'Common/Types/api/route';
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

export const testSmtp = (payload: $TSFixMe) => async (dispatch: Dispatch) => {
    dispatch(testSmtpRequest());

    try {
        const response = await BackendAPI.post(
            new Route('emailSmtp/test'),
            payload
        );
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

export const testTwilio = (payload: $TSFixMe) => async (dispatch: Dispatch) => {
    dispatch(testTwilioRequest());

    try {
        const response = await BackendAPI.post(
            new Route('twilio/sms/test'),
            payload
        );
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

export const fetchSettings = (type: $TSFixMe) => async (dispatch: Dispatch) => {
    dispatch(requestingSettings());
    try {
        const response = await BackendAPI.get(`globalConfig/${type}`);

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
        dispatch(requestingSettingsFailed(errorMsg));
    }
};

export const saveSettings =
    (type: $TSFixMe, settings: $TSFixMe) => async (dispatch: Dispatch) => {
        dispatch(requestingSettings());
        try {
            const response = await BackendAPI.post(`globalConfig`, {
                name: type,
                value: settings,
            });

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
            dispatch(requestingSettingsFailed(errorMsg));
        }
    };
