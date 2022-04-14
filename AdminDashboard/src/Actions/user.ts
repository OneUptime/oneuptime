import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/user';
import PositiveNumber from 'Common/Types/PositiveNumber';
export const fetchUsersRequest: Function = (): void => {
    return {
        type: types.FETCH_USERS_REQUEST,
    };
};

export const fetchUsersSuccess: Function = (users: $TSFixMe): void => {
    return {
        type: types.FETCH_USERS_SUCCESS,
        payload: users,
    };
};

export const fetchUsersError: Function = (error: $TSFixMe): void => {
    return {
        type: types.FETCH_USERS_FAILURE,
        payload: error,
    };
};

// Calls the API to fetch all users.
export const fetchUsers: $TSFixMe =
    (skip: PositiveNumber, limit: PositiveNumber) =>
    async (dispatch: Dispatch) => {
        skip = skip ? parseInt(skip) : 0;
        limit = limit ? parseInt(limit) : 10;
        dispatch(fetchUsersRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(
                `user/users?skip=${skip}&limit=${limit}`
            );

            const data: $TSFixMe = response.data;

            dispatch(fetchUsersSuccess(data));
            return response;
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
            dispatch(fetchUsersError(errorMsg));
        }
    };

export const fetchUserRequest: Function = (): void => {
    return {
        type: types.FETCH_USER_REQUEST,
    };
};

export const fetchUserSuccess: Function = (user: $TSFixMe): void => {
    return {
        type: types.FETCH_USER_SUCCESS,
        payload: user,
    };
};

export const fetchUserError: Function = (error: $TSFixMe): void => {
    return {
        type: types.FETCH_USER_FAILURE,
        payload: error,
    };
};

// Calls the API to fetch a user.
export const fetchUser: $TSFixMe =
    (userId: ObjectID) =>
    async (dispatch: Dispatch): void => {
        dispatch(fetchUserRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(`user/users/${userId}`);

            const data: $TSFixMe = response.data;

            dispatch(fetchUserSuccess(data));
            return response;
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
            dispatch(fetchUserError(errorMsg));
        }
    };

// Add user

export const addUserRequest: Function = (): void => {
    return {
        type: types.ADD_USER_REQUEST,
    };
};

export const addUserSuccess: Function = (user: $TSFixMe): void => {
    return {
        type: types.ADD_USER_SUCCESS,
        payload: user,
    };
};

export const addUserError: Function = (error: $TSFixMe): void => {
    return {
        type: types.ADD_USER_FAILURE,
        payload: error,
    };
};

export const resetAddUser: Function = (): void => {
    return {
        type: types.ADD_USER_RESET,
    };
};

// Calls the API to add user.
export const addUser: $TSFixMe =
    (user: $TSFixMe) =>
    async (dispatch: Dispatch): void => {
        try {
            dispatch(addUserRequest());

            const response: $TSFixMe = await BackendAPI.post(`user/signup`, user);

            const userResponse: $TSFixMe = await BackendAPI.get(
                `user/users/${response.data.id}`
            );

            dispatch(addUserSuccess(userResponse.data));
            return 'ok';
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
            dispatch(addUserError(errorMsg));
        }
    };

//Update user setting

export const updateUserSettingRequest: Function = (): void => {
    return {
        type: types.UPDATE_USER_SETTING_REQUEST,
    };
};

export const updateUserSettingSuccess: Function = (
    userSetting: $TSFixMe
): void => {
    return {
        type: types.UPDATE_USER_SETTING_SUCCESS,
        payload: userSetting,
    };
};

export const updateUserSettingError: Function = (error: $TSFixMe): void => {
    return {
        type: types.UPDATE_USER_SETTING_FAILURE,
        payload: error,
    };
};

// Calls the API to update user setting.
export const updateUserSetting: $TSFixMe =
    (values: $TSFixMe) => async (dispatch: Dispatch) => {
        const data: $TSFixMe = new FormData();
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
            const response: $TSFixMe = await BackendAPI.put(
                `user/profile/${values._id}`,
                data
            );

            const user: $TSFixMe = response.data;

            dispatch(updateUserSettingSuccess(user));
            return response;
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
            dispatch(updateUserSettingError(errorMsg));
        }
    };

export const logFile: Function = (file: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({ type: 'LOG_FILE', payload: file });
    };
};

export const resetFile: Function = (): void => {
    return function (dispatch: Dispatch): void {
        dispatch({ type: 'RESET_FILE' });
    };
};

//Delete user
export const deleteUserRequest: Function = (): void => {
    return {
        type: types.DELETE_USER_REQUEST,
    };
};

export const deleteUserReset: Function = (): void => {
    return {
        type: types.DELETE_USER_RESET,
    };
};

export const deleteUserSuccess: Function = (user: $TSFixMe): void => {
    return {
        type: types.DELETE_USER_SUCCESS,
        payload: user,
    };
};

export const deleteUserError: Function = (error: $TSFixMe): void => {
    return {
        type: types.DELETE_USER_FAILED,
        payload: error,
    };
};

// Calls the API to delete a user.
export const deleteUser: $TSFixMe =
    (userId: ObjectID) =>
    async (dispatch: Dispatch): void => {
        dispatch(deleteUserRequest());

        try {
            const response: $TSFixMe = await delete `user/${userId}`;

            const data: $TSFixMe = response.data;

            dispatch(deleteUserSuccess(data));
            return response;
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
            dispatch(deleteUserError(errorMsg));
        }
    };

//Restore user
export const restoreUserRequest: Function = (): void => {
    return {
        type: types.RESTORE_USER_REQUEST,
    };
};

export const restoreUserReset: Function = (): void => {
    return {
        type: types.RESTORE_USER_RESET,
    };
};

export const restoreUserSuccess: Function = (user: $TSFixMe): void => {
    return {
        type: types.RESTORE_USER_SUCCESS,
        payload: user,
    };
};

export const restoreUserError: Function = (error: $TSFixMe): void => {
    return {
        type: types.RESTORE_USER_FAILED,
        payload: error,
    };
};

// Calls the API to restore a user
export const restoreUser: $TSFixMe =
    (userId: ObjectID) =>
    async (dispatch: Dispatch): void => {
        dispatch(restoreUserRequest());

        try {
            const response: $TSFixMe = await BackendAPI.put(`user/${userId}/restoreUser`);

            const data: $TSFixMe = response.data;

            dispatch(restoreUserSuccess(data));
            return response;
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
            dispatch(restoreUserError(errorMsg));
        }
    };

//Block user
export const blockUserRequest: Function = (): void => {
    return {
        type: types.BLOCK_USER_REQUEST,
    };
};

export const blockUserReset: Function = (): void => {
    return {
        type: types.BLOCK_USER_RESET,
    };
};

export const blockUserSuccess: Function = (user: $TSFixMe): void => {
    return {
        type: types.BLOCK_USER_SUCCESS,
        payload: user,
    };
};

export const blockUserError: Function = (error: $TSFixMe): void => {
    return {
        type: types.BLOCK_USER_FAILED,
        payload: error,
    };
};

// Calls the API to restore a user
export const blockUser: $TSFixMe =
    (userId: ObjectID) =>
    async (dispatch: Dispatch): void => {
        dispatch(blockUserRequest());

        try {
            const response: $TSFixMe = await BackendAPI.put(`user/${userId}/blockUser`);

            const data: $TSFixMe = response.data;

            dispatch(blockUserSuccess(data));
            return response;
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
            dispatch(blockUserError(errorMsg));
        }
    };

//Enable Admin Mode
export const enableAdminModeRequest: Function = (): void => {
    return {
        type: types.ENABLE_ADMIN_MODE_REQUEST,
    };
};

export const enableAdminModeSuccess: Function = (user: $TSFixMe): void => {
    return {
        type: types.ENABLE_ADMIN_MODE_SUCCESS,
        payload: user,
    };
};

export const enableAdminModeError: Function = (error: $TSFixMe): void => {
    return {
        type: types.ENABLE_ADMIN_MODE_FAILED,
        payload: error,
    };
};

export const enableAdminModeReset: Function = (): void => {
    return {
        type: types.ENABLE_ADMIN_MODE_RESET,
    };
};

// Enable admin mode
export const enableAdminMode: $TSFixMe =
    (userId: ObjectID, values: $TSFixMe) => async (dispatch: Dispatch) => {
        dispatch(enableAdminModeRequest());

        try {
            const response: $TSFixMe = await BackendAPI.post(
                `user/${userId}/switchToAdminMode`,
                values
            );

            const data: $TSFixMe = response.data;

            dispatch(enableAdminModeSuccess(data));
            return response;
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
            dispatch(enableAdminModeError(errorMsg));
        }
    };

//Disable Admin Mode
export const disableAdminModeRequest: Function = (): void => {
    return {
        type: types.DISABLE_ADMIN_MODE_REQUEST,
    };
};

export const disableAdminModeSuccess: Function = (user: $TSFixMe): void => {
    return {
        type: types.DISABLE_ADMIN_MODE_SUCCESS,
        payload: user,
    };
};

export const disableAdminModeError: Function = (error: $TSFixMe): void => {
    return {
        type: types.DISABLE_ADMIN_MODE_FAILED,
        payload: error,
    };
};

export const disableAdminModeReset: Function = (): void => {
    return {
        type: types.DISABLE_ADMIN_MODE_RESET,
    };
};

// Disable admin mode
export const disableAdminMode: $TSFixMe =
    (userId: ObjectID) => async (dispatch: Dispatch) => {
        dispatch(disableAdminModeRequest());

        try {
            const response: $TSFixMe = await BackendAPI.post(
                `user/${userId}/exitAdminMode`
            );

            const data: $TSFixMe = response.data;

            dispatch(disableAdminModeSuccess(data));
            return response;
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
            dispatch(disableAdminModeError(errorMsg));
        }
    };

//Unblock user
export const unblockUserRequest: Function = (): void => {
    return {
        type: types.UNBLOCK_USER_REQUEST,
    };
};

export const unblockUserReset: Function = (): void => {
    return {
        type: types.UNBLOCK_USER_RESET,
    };
};

export const unblockUserSuccess: Function = (user: $TSFixMe): void => {
    return {
        type: types.UNBLOCK_USER_SUCCESS,
        payload: user,
    };
};

export const unblockUserError: Function = (error: $TSFixMe): void => {
    return {
        type: types.UNBLOCK_USER_FAILED,
        payload: error,
    };
};

// Calls the API to unblock a user
export const unblockUser: $TSFixMe =
    (userId: ObjectID) =>
    async (dispatch: Dispatch): void => {
        dispatch(unblockUserRequest());

        try {
            const response: $TSFixMe = await BackendAPI.put(`user/${userId}/unblockUser`);

            const data: $TSFixMe = response.data;

            dispatch(unblockUserSuccess(data));
            return response;
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
            dispatch(unblockUserError(errorMsg));
        }
    };

//Add Project Notes
export const addUserNoteRequest: Function = (): void => {
    return {
        type: types.ADD_USER_NOTE_REQUEST,
    };
};

export const addUserNoteReset: Function = (): void => {
    return {
        type: types.ADD_USER_NOTE_RESET,
    };
};

export const addUserNoteSuccess: Function = (userNote: $TSFixMe): void => {
    return {
        type: types.ADD_USER_NOTE_SUCCESS,
        payload: userNote,
    };
};

export const addUserNoteError: Function = (error: $TSFixMe): void => {
    return {
        type: types.ADD_USER_NOTE_FAILURE,
        payload: error,
    };
};

// Calls the API to add Admin Note
export const addUserNote: $TSFixMe =
    (userId: ObjectID, values: $TSFixMe) => async (dispatch: Dispatch) => {
        dispatch(addUserNoteRequest());

        try {
            const response: $TSFixMe = await BackendAPI.post(
                `user/${userId}/addNote`,
                values
            );

            const data: $TSFixMe = response.data;

            dispatch(addUserNoteSuccess(data));
            return response;
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
            dispatch(addUserNoteError(errorMsg));
        }
    };

//Search Users
export const searchUsersRequest: Function = (): void => {
    return {
        type: types.SEARCH_USERS_REQUEST,
    };
};

export const searchUsersReset: Function = (): void => {
    return {
        type: types.SEARCH_USERS_RESET,
    };
};

export const searchUsersSuccess: Function = (users: $TSFixMe): void => {
    return {
        type: types.SEARCH_USERS_SUCCESS,
        payload: users,
    };
};

export const searchUsersError: Function = (error: $TSFixMe): void => {
    return {
        type: types.SEARCH_USERS_FAILURE,
        payload: error,
    };
};

// Calls the search users api
export const searchUsers: $TSFixMe =
    (filter: $TSFixMe, skip: PositiveNumber, limit: PositiveNumber) =>
    async (dispatch: Dispatch) => {
        const values: $TSFixMe = {
            filter,
        };
        skip = skip ? parseInt(skip) : 0;
        limit = limit ? parseInt(limit) : 10;

        dispatch(searchUsersRequest());

        try {
            const response: $TSFixMe = await BackendAPI.post(
                `user/users/search?skip=${skip}&limit=${limit}`,
                values
            );

            const data: $TSFixMe = response.data;

            dispatch(searchUsersSuccess(data));
            return response;
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
            dispatch(searchUsersError(errorMsg));
        }
    };

// Update user twoFactorAuthToken
export const twoFactorAuthTokenRequest: Function = (): void => {
    return {
        type: types.UPDATE_TWO_FACTOR_AUTH_REQUEST,
    };
};

export const twoFactorAuthTokenSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.UPDATE_TWO_FACTOR_AUTH_SUCCESS,
        payload: payload,
    };
};

export const twoFactorAuthTokenError: Function = (error: $TSFixMe): void => {
    return {
        type: types.UPDATE_TWO_FACTOR_AUTH_FAILURE,
        payload: error,
    };
};

export const updateTwoFactorAuthToken: Function = (
    userId: ObjectID,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(`user/${userId}/2fa`, data);
        dispatch(twoFactorAuthTokenRequest());
        promise.then(
            (response): void => {
                const payload: $TSFixMe = response.data;
                dispatch(twoFactorAuthTokenSuccess(payload));
                return payload;
            },
            (error): void => {
                dispatch(twoFactorAuthTokenError(error));
            }
        );

        return promise;
    };
};

export const setTwoFactorAuth: Function = (enabled: $TSFixMe): void => {
    return {
        type: types.SET_TWO_FACTOR_AUTH,
        payload: enabled,
    };
};

//fetching user login history
// Update user twoFactorAuthToken
export const fetchUserHistoryRequest: Function = (): void => {
    return {
        type: types.FETCH_USER_LOGIN_HISTORY_REQUEST,
    };
};

export const fetchUserHistorySuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_USER_LOGIN_HISTORY_SUCCESS,
        payload: payload,
    };
};

export const fetchUserHistoryError: Function = (error: $TSFixMe): void => {
    return {
        type: types.FETCH_USER_LOGIN_HISTORY_FAILURE,
        payload: error,
    };
};

export function fetchUserloginHistory(
    userId: ObjectID,
    skip: PositiveNumber,
    limit = 10
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `history/${userId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchUserHistoryRequest());
        promise.then(
            (response): void => {
                const payload: $TSFixMe = response.data;
                dispatch(fetchUserHistorySuccess(payload));
                return payload;
            },
            (error): void => {
                dispatch(fetchUserHistoryError(error));
            }
        );

        return promise;
    };
}
