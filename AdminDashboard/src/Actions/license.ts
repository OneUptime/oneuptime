import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/license';
import Route from 'Common/Types/api/route';
// fetch license

export const fetchLicenseRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.FETCH_LICENSE_REQUEST,
        payload: promise,
    };
};

export const fetchLicenseError: Function = (error: $TSFixMe): void => {
    return {
        type: types.FETCH_LICENSE_FAILED,
        payload: error,
    };
};

export const fetchLicenseSuccess: Function = (license: $TSFixMe): void => {
    return {
        type: types.FETCH_LICENSE_SUCCESS,
        payload: license,
    };
};

export const resetFetchLicense: Function = (): void => {
    return {
        type: types.FETCH_LICENSE_RESET,
    };
};

// Calls the API to fetch license
export const fetchLicense: $TSFixMe =
    () =>
    async (dispatch: Dispatch): void => {
        dispatch(fetchLicenseRequest());
        dispatch(resetConfirmLicense());

        try {
            const response: $TSFixMe = await BackendAPI.post(
                new Route('globalConfig/configs'),
                ['licenseKey', 'licenseEmail', 'licenseToken']
            );

            const data: $TSFixMe = response.data;
            dispatch(fetchLicenseSuccess(data));
            return data;
        } catch (error) {
            let errorMsg;
            if (error && error.response && error.response.data) {
                errorMsg = error.response.data;
            }
            if (error && error.data) {
                errorMsg = error.data;
            }
            if (error && error.message) {
                errorMsg = error.message;
            } else {
                errorMsg = 'Network Error';
            }
            dispatch(fetchLicenseError(errorMsg));
            return 'error';
        }
    };

// confirm license

export const confirmLicenseRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.CONFIRM_LICENSE_REQUEST,
        payload: promise,
    };
};

export const confirmLicenseError: Function = (error: $TSFixMe): void => {
    return {
        type: types.CONFIRM_LICENSE_FAILED,
        payload: error,
    };
};

export const confirmLicenseSuccess: Function = (license: $TSFixMe): void => {
    return {
        type: types.CONFIRM_LICENSE_SUCCESS,
        payload: license,
    };
};

export const resetConfirmLicense: Function = (): void => {
    return {
        type: types.CONFIRM_LICENSE_RESET,
    };
};

// Calls the API to confirm license
export const confirmLicense: $TSFixMe =
    (values: $TSFixMe) => async (dispatch: Dispatch) => {
        dispatch(confirmLicenseRequest());

        try {
            const response: $TSFixMe = await BackendAPI.post(
                'license/validate/',
                values,
                true
            );

            let data = response.data;
            if (data.token) {
                const response: $TSFixMe = await BackendAPI.post(
                    new Route('globalConfig/'),
                    [
                        { name: 'licenseKey', value: values.license },
                        { name: 'licenseEmail', value: values.email },
                        { name: 'licenseToken', value: data.token },
                    ]
                );

                data = response.data;
            }
            dispatch(confirmLicenseSuccess(data));
            return data;
        } catch (error) {
            let errorMsg;
            if (error && error.response && error.response.data) {
                errorMsg = error.response.data;
            }
            if (error && error.data) {
                errorMsg = error.data;
            }
            if (error && error.message) {
                errorMsg = error.message;
            } else {
                errorMsg = 'Network Error';
            }
            dispatch(confirmLicenseError(errorMsg));
            return 'error';
        }
    };
