import BackendAPI from 'CommonUI/src/Utils/API/Backend';
import Route from 'Common/Types/api/route';
import * as types from '../constants/changePassword';
export const changePasswordRequest = (promise) => {
    return {
        type: types.CHANGEPASSWORD_REQUEST,
        payload: promise,
    };
};
export const changePasswordError = (error) => {
    return {
        type: types.CHANGEPASSWORD_FAILED,
        payload: error,
    };
};
export const changePasswordSuccess = (values) => {
    return {
        type: types.CHANGEPASSWORD_SUCCESS,
        payload: values,
    };
};
export const resetChangePassword = () => {
    return {
        type: types.RESET_CHANGEPASSWORD,
    };
};
// Calls the API to register a user.
export const changePassword = (values) => {
    return function (dispatch) {
        const promise = BackendAPI.post(new Route('user/reset-password'), values);
        dispatch(changePasswordRequest(promise));
        promise.then((response) => {
            dispatch(changePasswordSuccess(response.data));
        }, (error) => {
            dispatch(changePasswordError(error));
        });
    };
};
