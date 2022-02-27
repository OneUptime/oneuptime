import { postApi } from '../api';
import * as types from '../constants/license';
import errors from '../errors';

// fetch license

export function fetchLicenseRequest(promise: $TSFixMe) {
    return {
        type: types.FETCH_LICENSE_REQUEST,
        payload: promise,
    };
}

export function fetchLicenseError(error: $TSFixMe) {
    return {
        type: types.FETCH_LICENSE_FAILED,
        payload: error,
    };
}

export function fetchLicenseSuccess(license: $TSFixMe) {
    return {
        type: types.FETCH_LICENSE_SUCCESS,
        payload: license,
    };
}

export const resetFetchLicense = () => {
    return {
        type: types.FETCH_LICENSE_RESET,
    };
};

// Calls the API to fetch license
export const fetchLicense = () => async (dispatch: $TSFixMe) => {
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 0.
    dispatch(fetchLicenseRequest());
    dispatch(resetConfirmLicense());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        const response = await postApi('globalConfig/configs', [
            'licenseKey',
            'licenseEmail',
            'licenseToken',
        ]);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        const data = response.data;
        dispatch(fetchLicenseSuccess(data));
        return data;
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
        dispatch(fetchLicenseError(errors(errorMsg)));
        return 'error';
    }
};

// confirm license

export function confirmLicenseRequest(promise: $TSFixMe) {
    return {
        type: types.CONFIRM_LICENSE_REQUEST,
        payload: promise,
    };
}

export function confirmLicenseError(error: $TSFixMe) {
    return {
        type: types.CONFIRM_LICENSE_FAILED,
        payload: error,
    };
}

export function confirmLicenseSuccess(license: $TSFixMe) {
    return {
        type: types.CONFIRM_LICENSE_SUCCESS,
        payload: license,
    };
}

export const resetConfirmLicense = () => {
    return {
        type: types.CONFIRM_LICENSE_RESET,
    };
};

// Calls the API to confirm license
export const confirmLicense = (values: $TSFixMe) => async (
    dispatch: $TSFixMe
) => {
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 0.
    dispatch(confirmLicenseRequest());

    try {
        const response = await postApi('license/validate/', values, true);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        let data = response.data;
        if (data.token) {
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const response = await postApi('globalConfig/', [
                { name: 'licenseKey', value: values.license },
                { name: 'licenseEmail', value: values.email },
                { name: 'licenseToken', value: data.token },
            ]);
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            data = response.data;
        }
        dispatch(confirmLicenseSuccess(data));
        return data;
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
        dispatch(confirmLicenseError(errors(errorMsg)));
        return 'error';
    }
};
