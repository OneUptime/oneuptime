import * as types from '../constants/group';
import { postApi, getApi, deleteApi, putApi } from '../api';
import { User } from '../config.js';

// Add Group
export const addGroupRequest = () => ({
    type: types.CREATE_GROUP_REQUEST,
});

export const addGroupSuccess = payload => ({
    type: types.CREATE_GROUP_SUCCESS,
    payload,
});

export const addGroupFailure = error => ({
    type: types.CREATE_GROUP_FAILURE,
    payload: error,
});

export const createGroup = (projectId, data) => async dispatch => {
    dispatch(addGroupRequest());

    try {
        const response = await postApi(`group/${projectId}`, data);
        dispatch(addGroupSuccess(response.data));
        dispatch(getGroups());
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(addGroupFailure(errorMsg));
    }
};

// Edit and update Groups
export const updateGroupRequest = () => ({
    type: types.UPDATE_GROUP_REQUEST,
});

export const updateGroupSuccess = payload => ({
    type: types.UPDATE_GROUP_SUCCESS,
    payload,
});

export const updateGroupFailure = error => ({
    type: types.UPDATE_GROUP_FAILURE,
    payload: error,
});

export const updateGroup = (projectId, groupId, data) => async dispatch => {
    dispatch(updateGroupRequest());

    try {
        const response = await putApi(`group/${projectId}/${groupId}`, data);
        dispatch(updateGroupSuccess(response.data));
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
        dispatch(updateGroupFailure(errorMsg));
        return errorMsg;
    }
};

// Get groups Credential
export const getGroupsRequest = () => ({
    type: types.GET_GROUPS_REQUEST,
});

export const getGroupsSuccess = payload => ({
    type: types.GET_GROUPS_SUCCESS,
    payload,
});

export const getGroupsFailure = error => ({
    type: types.GET_GROUPS_FAILURE,
    payload: error,
});

export const getGroups = () => async dispatch => {
    dispatch(getGroupsRequest());
    const projectId = User.getCurrentProjectId();
    try {
        const response = await getApi(`group/${projectId}`);
        dispatch(getGroupsSuccess(response.data));
    } catch (error) {
        const errorMsg =
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

// Delete Group
export const deleteGroupRequest = () => ({
    type: types.DELETE_GROUP_REQUEST,
});

export const deleteGroupSuccess = payload => ({
    type: types.DELETE_GROUP_SUCCESS,
    payload,
});

export const deleteGroupFailure = error => ({
    type: types.DELETE_GROUP_FAILURE,
    payload: error,
});

export const deleteGroup = ({ projectId, groupId }) => async dispatch => {
    dispatch(deleteGroupRequest());

    try {
        const response = await deleteApi(`group/${projectId}/${groupId}`);

        dispatch(deleteGroupSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';

        dispatch(deleteGroupFailure(errorMsg));
    }
};
