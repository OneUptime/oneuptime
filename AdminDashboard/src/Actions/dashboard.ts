import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/dashboard';

export const dashboardLoadRequest: $TSFixMe = function (): void {
    return {
        type: types.DASHBOARD_LOAD_REQUEST,
    };
};
export const dashboardLoadSuccess: $TSFixMe = function (): void {
    return {
        type: types.DASHBOARD_LOAD_SUCCESS,
    };
};
export const resetDashboardLoad: $TSFixMe = function (): void {
    return {
        type: types.DASHBOARD_LOAD_RESET,
    };
};

export const dashboardLoadFailed: $TSFixMe = function (
    payload: $TSFixMe
): void {
    return {
        type: types.DASHBOARD_LOAD_FAILED,
        payload,
    };
};

export const loadDashboard: $TSFixMe = () => {
    return async (dispatch: Dispatch): void => {
        const skip: $TSFixMe = 0;
        const limit: $TSFixMe = 10;
        dispatch(dashboardLoadRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(
                `user/users?skip=${skip}&limit=${limit}`
            );
            dispatch(dashboardLoadSuccess());

            return response;
        } catch (error) {
            let errorMsg: $TSFixMe;
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
            dispatch(dashboardLoadFailed(errorMsg));
        }
    };
};
