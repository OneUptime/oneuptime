import { getApi } from '../api';
import * as types from '../constants/dashboard';
import errors from '../errors';

export const dashboardLoadRequest = function () {
    return {
        type: types.DASHBOARD_LOAD_REQUEST,
    };
};
export const dashboardLoadSuccess = function () {
    return {
        type: types.DASHBOARD_LOAD_SUCCESS,
    };
};
export const resetDashboardLoad = function () {
    return {
        type: types.DASHBOARD_LOAD_RESET,
    };
};

export const dashboardLoadFailed = function (payload: $TSFixMe) {
    return {
        type: types.DASHBOARD_LOAD_FAILED,
        payload,
    };
};

export const loadDashboard = () => async (dispatch: $TSFixMe) => {
    const skip = 0;
    const limit = 10;
    dispatch(dashboardLoadRequest());

    try {
        const response = await getApi(`user/users?skip=${skip}&limit=${limit}`);
        dispatch(dashboardLoadSuccess());

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
        dispatch(dashboardLoadFailed(errors(errorMsg)));
    }
};
