import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/user';
import PositiveNumber from 'Common/Types/PositiveNumber';
export const fetchUsersRequest = (): void => {
    return {
        type: types.FETCH_USERS_REQUEST,
    };
};

export const fetchUsersSuccess = (users: $TSFixMe): void => {
    return {
        type: types.FETCH_USERS_SUCCESS,
        payload: users,
    };
};

export const fetchUsersError = (error: $TSFixMe): void => {
    return {
        type: types.FETCH_USERS_FAILURE,
        payload: error,
    };
};

// Calls the API to fetch all users.
export const fetchUsers =
    (skip: PositiveNumber, limit: PositiveNumber) =>
    async (dispatch: Dispatch) => {
        skip = skip ? parseInt(skip) : 0;
        limit = limit ? parseInt(limit) : 10;
        dispatch(fetchUsersRequest());

        try {
            const response = await BackendAPI.get(
                `user/users?skip=${skip}&limit=${limit}`
            );

            const data = response.data;

            dispatch(fetchUsersSuccess(data));
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
            dispatch(fetchUsersError(errorMsg));
        }
    };

export const fetchUserRequest = (): void => {
    return {
        type: types.FETCH_USER_REQUEST,
    };
};

export const fetchUserSuccess = (user: $TSFixMe): void => {
    return {
        type: types.FETCH_USER_SUCCESS,
        payload: user,
    };
};

export const fetchUserError = (error: $TSFixMe): void => {
    return {
        type: types.FETCH_USER_FAILURE,
        payload: error,
    };
};

// Calls the API to fetch a user.
export const fetchUser =
    (userId: string) =>
    async (dispatch: Dispatch): void => {
        dispatch(fetchUserRequest());

        try {
            const response = await BackendAPI.get(`user/users/${userId}`);

            const data = response.data;

            dispatch(fetchUserSuccess(data));
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
            dispatch(fetchUserError(errorMsg));
        }
    };

// Add user

export const addUserRequest = (): void => {
    return {
        type: types.ADD_USER_REQUEST,
    };
};

export const addUserSuccess = (user: $TSFixMe): void => {
    return {
        type: types.ADD_USER_SUCCESS,
        payload: user,
    };
};

export const addUserError = (error: $TSFixMe): void => {
    return {
        type: types.ADD_USER_FAILURE,
        payload: error,
    };
};

export const resetAddUser = (): void => {
    return {
        type: types.ADD_USER_RESET,
    };
};

// Calls the API to add user.
export const addUser =
    (user: $TSFixMe) =>
    async (dispatch: Dispatch): void => {
        try {
            dispatch(addUserRequest());

            const response = await BackendAPI.post(`user/signup`, user);

            const userResponse = await BackendAPI.get(
                `user/users/${response.data.id}`
            );

            dispatch(addUserSuccess(userResponse.data));
            return 'ok';
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
            dispatch(addUserError(errorMsg));
        }
    };

//Update user setting

export const updateUserSettingRequest = (): void => {
    return {
        type: types.UPDATE_USER_SETTING_REQUEST,
    };
};

export const updateUserSettingSuccess = (userSetting: $TSFixMe): void => {
    return {
        type: types.UPDATE_USER_SETTING_SUCCESS,
        payload: userSetting,
    };
};

export const updateUserSettingError = (error: $TSFixMe): void => {
    return {
        type: types.UPDATE_USER_SETTING_FAILURE,
        payload: error,
    };
};

// Calls the API to update user setting.
export const updateUserSetting =
    (values: $TSFixMe) => async (dispatch: Dispatch) => {
        const data = new FormData();
        if (values.profilePic && values.profilePic[0]) {
            data.append(
                'profilePic',
                values.profilePic[0],
                values.profilePic[0].name
            );
        }

        data.append('name', values.name);
        data.append('email', values.email);
        data.append('companyPhoneNumber', values.companyPhoneNumber);
        data.append('timezone', values.timezone);
        dispatch(updateUserSettingRequest());

        try {
            const response = await BackendAPI.put(
                `user/profile/${values._id}`,
                data
            );

            const user = response.data;

            dispatch(updateUserSettingSuccess(user));
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
            dispatch(updateUserSettingError(errorMsg));
        }
    };

export const logFile = (file: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({ type: 'LOG_FILE', payload: file });
    };
};

export const resetFile = (): void => {
    return function (dispatch: Dispatch): void {
        dispatch({ type: 'RESET_FILE' });
    };
};

//Delete user
export const deleteUserRequest = (): void => {
    return {
        type: types.DELETE_USER_REQUEST,
    };
};

export const deleteUserReset = (): void => {
    return {
        type: types.DELETE_USER_RESET,
    };
};

export const deleteUserSuccess = (user: $TSFixMe): void => {
    return {
        type: types.DELETE_USER_SUCCESS,
        payload: user,
    };
};

export const deleteUserError = (error: $TSFixMe): void => {
    return {
        type: types.DELETE_USER_FAILED,
        payload: error,
    };
};

// Calls the API to delete a user.
export const deleteUser =
    (userId: string) =>
    async (dispatch: Dispatch): void => {
        dispatch(deleteUserRequest());

        try {
            const response = await delete `user/${userId}`;

            const data = response.data;

            dispatch(deleteUserSuccess(data));
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
            dispatch(deleteUserError(errorMsg));
        }
    };

//Restore user
export const restoreUserRequest = (): void => {
    return {
        type: types.RESTORE_USER_REQUEST,
    };
};

export const restoreUserReset = (): void => {
    return {
        type: types.RESTORE_USER_RESET,
    };
};

export const restoreUserSuccess = (user: $TSFixMe): void => {
    return {
        type: types.RESTORE_USER_SUCCESS,
        payload: user,
    };
};

export const restoreUserError = (error: $TSFixMe): void => {
    return {
        type: types.RESTORE_USER_FAILED,
        payload: error,
    };
};

// Calls the API to restore a user
export const restoreUser =
    (userId: string) =>
    async (dispatch: Dispatch): void => {
        dispatch(restoreUserRequest());

        try {
            const response = await BackendAPI.put(`user/${userId}/restoreUser`);

            const data = response.data;

            dispatch(restoreUserSuccess(data));
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
            dispatch(restoreUserError(errorMsg));
        }
    };

//Block user
export const blockUserRequest = (): void => {
    return {
        type: types.BLOCK_USER_REQUEST,
    };
};

export const blockUserReset = (): void => {
    return {
        type: types.BLOCK_USER_RESET,
    };
};

export const blockUserSuccess = (user: $TSFixMe): void => {
    return {
        type: types.BLOCK_USER_SUCCESS,
        payload: user,
    };
};

export const blockUserError = (error: $TSFixMe): void => {
    return {
        type: types.BLOCK_USER_FAILED,
        payload: error,
    };
};

// Calls the API to restore a user
export const blockUser =
    (userId: string) =>
    async (dispatch: Dispatch): void => {
        dispatch(blockUserRequest());

        try {
            const response = await BackendAPI.put(`user/${userId}/blockUser`);

            const data = response.data;

            dispatch(blockUserSuccess(data));
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
            dispatch(blockUserError(errorMsg));
        }
    };

//Enable Admin Mode
export const enableAdminModeRequest = (): void => {
    return {
        type: types.ENABLE_ADMIN_MODE_REQUEST,
    };
};

export const enableAdminModeSuccess = (user: $TSFixMe): void => {
    return {
        type: types.ENABLE_ADMIN_MODE_SUCCESS,
        payload: user,
    };
};

export const enableAdminModeError = (error: $TSFixMe): void => {
    return {
        type: types.ENABLE_ADMIN_MODE_FAILED,
        payload: error,
    };
};

export const enableAdminModeReset = (): void => {
    return {
        type: types.ENABLE_ADMIN_MODE_RESET,
    };
};

// Enable admin mode
export const enableAdminMode =
    (userId: string, values: $TSFixMe) => async (dispatch: Dispatch) => {
        dispatch(enableAdminModeRequest());

        try {
            const response = await BackendAPI.post(
                `user/${userId}/switchToAdminMode`,
                values
            );

            const data = response.data;

            dispatch(enableAdminModeSuccess(data));
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
            dispatch(enableAdminModeError(errorMsg));
        }
    };

//Disable Admin Mode
export const disableAdminModeRequest = (): void => {
    return {
        type: types.DISABLE_ADMIN_MODE_REQUEST,
    };
};

export const disableAdminModeSuccess = (user: $TSFixMe): void => {
    return {
        type: types.DISABLE_ADMIN_MODE_SUCCESS,
        payload: user,
    };
};

export const disableAdminModeError = (error: $TSFixMe): void => {
    return {
        type: types.DISABLE_ADMIN_MODE_FAILED,
        payload: error,
    };
};

export const disableAdminModeReset = (): void => {
    return {
        type: types.DISABLE_ADMIN_MODE_RESET,
    };
};

// Disable admin mode
export const disableAdminMode =
    (userId: string) => async (dispatch: Dispatch) => {
        dispatch(disableAdminModeRequest());

        try {
            const response = await BackendAPI.post(
                `user/${userId}/exitAdminMode`
            );

            const data = response.data;

            dispatch(disableAdminModeSuccess(data));
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
            dispatch(disableAdminModeError(errorMsg));
        }
    };

//Unblock user
export const unblockUserRequest = (): void => {
    return {
        type: types.UNBLOCK_USER_REQUEST,
    };
};

export const unblockUserReset = (): void => {
    return {
        type: types.UNBLOCK_USER_RESET,
    };
};

export const unblockUserSuccess = (user: $TSFixMe): void => {
    return {
        type: types.UNBLOCK_USER_SUCCESS,
        payload: user,
    };
};

export const unblockUserError = (error: $TSFixMe): void => {
    return {
        type: types.UNBLOCK_USER_FAILED,
        payload: error,
    };
};

// Calls the API to unblock a user
export const unblockUser =
    (userId: string) =>
    async (dispatch: Dispatch): void => {
        dispatch(unblockUserRequest());

        try {
            const response = await BackendAPI.put(`user/${userId}/unblockUser`);

            const data = response.data;

            dispatch(unblockUserSuccess(data));
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
            dispatch(unblockUserError(errorMsg));
        }
    };

//Add Project Notes
export const addUserNoteRequest = (): void => {
    return {
        type: types.ADD_USER_NOTE_REQUEST,
    };
};

export const addUserNoteReset = (): void => {
    return {
        type: types.ADD_USER_NOTE_RESET,
    };
};

export const addUserNoteSuccess = (userNote: $TSFixMe): void => {
    return {
        type: types.ADD_USER_NOTE_SUCCESS,
        payload: userNote,
    };
};

export const addUserNoteError = (error: $TSFixMe): void => {
    return {
        type: types.ADD_USER_NOTE_FAILURE,
        payload: error,
    };
};

// Calls the API to add Admin Note
export const addUserNote =
    (userId: string, values: $TSFixMe) => async (dispatch: Dispatch) => {
        dispatch(addUserNoteRequest());

        try {
            const response = await BackendAPI.post(
                `user/${userId}/addNote`,
                values
            );

            const data = response.data;

            dispatch(addUserNoteSuccess(data));
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
            dispatch(addUserNoteError(errorMsg));
        }
    };

//Search Users
export const searchUsersRequest = (): void => {
    return {
        type: types.SEARCH_USERS_REQUEST,
    };
};

export const searchUsersReset = (): void => {
    return {
        type: types.SEARCH_USERS_RESET,
    };
};

export const searchUsersSuccess = (users: $TSFixMe): void => {
    return {
        type: types.SEARCH_USERS_SUCCESS,
        payload: users,
    };
};

export const searchUsersError = (error: $TSFixMe): void => {
    return {
        type: types.SEARCH_USERS_FAILURE,
        payload: error,
    };
};

// Calls the search users api
export const searchUsers =
    (filter: $TSFixMe, skip: PositiveNumber, limit: PositiveNumber) =>
    async (dispatch: Dispatch) => {
        const values = {
            filter,
        };
        skip = skip ? parseInt(skip) : 0;
        limit = limit ? parseInt(limit) : 10;

        dispatch(searchUsersRequest());

        try {
            const response = await BackendAPI.post(
                `user/users/search?skip=${skip}&limit=${limit}`,
                values
            );

            const data = response.data;

            dispatch(searchUsersSuccess(data));
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
            dispatch(searchUsersError(errorMsg));
        }
    };

// Update user twoFactorAuthToken
export const twoFactorAuthTokenRequest = (): void => {
    return {
        type: types.UPDATE_TWO_FACTOR_AUTH_REQUEST,
    };
};

export const twoFactorAuthTokenSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.UPDATE_TWO_FACTOR_AUTH_SUCCESS,
        payload: payload,
    };
};

export const twoFactorAuthTokenError = (error: $TSFixMe): void => {
    return {
        type: types.UPDATE_TWO_FACTOR_AUTH_FAILURE,
        payload: error,
    };
};

export const updateTwoFactorAuthToken = (
    userId: string,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put(`user/${userId}/2fa`, data);
        dispatch(twoFactorAuthTokenRequest());
        promise.then(
            function (response): void {
                const payload = response.data;
                dispatch(twoFactorAuthTokenSuccess(payload));
                return payload;
            },
            function (error): void {
                dispatch(twoFactorAuthTokenError(error));
            }
        );

        return promise;
    };
};

export const setTwoFactorAuth = (enabled: $TSFixMe): void => {
    return {
        type: types.SET_TWO_FACTOR_AUTH,
        payload: enabled,
    };
};

//fetching user login history
// Update user twoFactorAuthToken
export const fetchUserHistoryRequest = (): void => {
    return {
        type: types.FETCH_USER_LOGIN_HISTORY_REQUEST,
    };
};

export const fetchUserHistorySuccess = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_USER_LOGIN_HISTORY_SUCCESS,
        payload: payload,
    };
};

export const fetchUserHistoryError = (error: $TSFixMe): void => {
    return {
        type: types.FETCH_USER_LOGIN_HISTORY_FAILURE,
        payload: error,
    };
};

export function fetchUserloginHistory(
    userId: string,
    skip: PositiveNumber,
    limit = 10
): void {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `history/${userId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchUserHistoryRequest());
        promise.then(
            function (response): void {
                const payload = response.data;
                dispatch(fetchUserHistorySuccess(payload));
                return payload;
            },
            function (error): void {
                dispatch(fetchUserHistoryError(error));
            }
        );

        return promise;
    };
}
