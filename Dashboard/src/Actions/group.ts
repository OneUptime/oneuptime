import * as types from '../constants/group';
import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import { User } from '../config.js';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
// Add Group
export const addGroupRequest: Function = (): void => {
    return {
        type: types.CREATE_GROUP_REQUEST,
    };
};

export const addGroupSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.CREATE_GROUP_SUCCESS,
        payload,
    };
};

export const addGroupFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_GROUP_FAILURE,
        payload: error,
    };
};

export const createGroup: $TSFixMe = (projectId: ObjectID, data: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(addGroupRequest());

        try {
            const response: $TSFixMe = await BackendAPI.post(
                `group/${projectId}`,
                data
            );

            dispatch(addGroupSuccess(response.data));
            dispatch(getGroups());
            return response;
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(addGroupFailure(errorMsg));
            return { error: errorMsg };
        }
    };
};

// Edit and update Groups
export const updateGroupRequest: Function = (payload: $TSFixMe): void => {
    return {
        type: types.UPDATE_GROUP_REQUEST,
        payload,
    };
};

export const updateGroupSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.UPDATE_GROUP_SUCCESS,
        payload,
    };
};

export const updateGroupFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.UPDATE_GROUP_FAILURE,
        payload: error,
    };
};

export const updateGroup: $TSFixMe = (
    projectId: ObjectID,
    groupId: $TSFixMe,
    data: $TSFixMe
) => {
    return async (dispatch: Dispatch) => {
        dispatch(updateGroupRequest(groupId));

        try {
            const response: $TSFixMe = await BackendAPI.put(
                `group/${projectId}/${groupId}`,
                data
            );

            dispatch(updateGroupSuccess(response.data));
            return response;
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(updateGroupFailure(errorMsg));
            return { error: errorMsg };
        }
    };
};

// Get all project and subproject groups
export const getGroupsRequest: Function = (): void => {
    return {
        type: types.GET_GROUPS_REQUEST,
    };
};

export const getGroupsSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.GET_GROUPS_SUCCESS,
        payload,
    };
};

export const getGroupsFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.GET_GROUPS_FAILURE,
        payload: error,
    };
};

export const getGroups: $TSFixMe = () => {
    return async (dispatch: Dispatch): void => {
        dispatch(getGroupsRequest());
        const projectId: $TSFixMe = User.getCurrentProjectId();
        try {
            const response: $TSFixMe = await BackendAPI.get(
                `group/${projectId}/groups`
            );

            dispatch(getGroupsSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(getGroupsFailure(errorMsg));
        }
    };
};

// Get project groups
export const getProjectGroupsRequest: Function = (): void => {
    return {
        type: types.GET_PROJECT_GROUPS_REQUEST,
    };
};

export const getProjectGroupsSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.GET_PROJECT_GROUPS_SUCCESS,
        payload,
    };
};

export const getProjectGroupsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.GET_PROJECT_GROUPS_FAILURE,
        payload: error,
    };
};

export const getProjectGroups: $TSFixMe = (
    projectId: ObjectID,
    skip: PositiveNumber,
    limit: PositiveNumber
) => {
    return async (dispatch: Dispatch) => {
        dispatch(getProjectGroupsRequest());
        try {
            const response: $TSFixMe = await BackendAPI.get(
                `group/${projectId}?skip=${skip}&limit=${limit}`
            );

            dispatch(getProjectGroupsSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(getProjectGroupsFailure(errorMsg));
        }
    };
};

// Delete Group
export const deleteGroupRequest: Function = (): void => {
    return {
        type: types.DELETE_GROUP_REQUEST,
    };
};

export const deleteGroupSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.DELETE_GROUP_SUCCESS,
        payload,
    };
};

export const deleteGroupFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_GROUP_FAILURE,
        payload: error,
    };
};

export const deleteGroup: $TSFixMe = (
    projectId: ObjectID,
    groupId: $TSFixMe
) => {
    return async (dispatch: Dispatch) => {
        dispatch(deleteGroupRequest());

        try {
            const response: $TSFixMe =
                await delete `group/${projectId}/${groupId}`;

            dispatch(deleteGroupSuccess(response.data));
            dispatch(getGroups());
            return response;
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';

            dispatch(deleteGroupFailure(errorMsg));
            return errorMsg;
        }
    };
};

//Reset error message
export const resetErrorMessage: Function = (): void => {
    return {
        type: types.RESET_ERROR_MESSAGE,
    };
};
