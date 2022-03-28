import BackendAPI from 'common-ui/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/subProject';
import ErrorPayload from 'common-ui/src/payload-types/error';
import { User } from '../config';

export const subProjectsRequest = (promise: $TSFixMe) => {
    return {
        type: types.SUBPROJECTS_REQUEST,
        payload: promise,
    };
};

export const subProjectsError = (error: ErrorPayload) => {
    return {
        type: types.SUBPROJECTS_FAILED,
        payload: error,
    };
};

export const subProjectsSuccess = (subProjects: $TSFixMe) => {
    return {
        type: types.SUBPROJECTS_SUCCESS,
        payload: subProjects,
    };
};

export const resetSubProjects = () => {
    return {
        type: types.SUBPROJECTS_RESET,
    };
};

export const getSubProjects = (projectId: $TSFixMe, skip = 0, limit = 10) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `project/${projectId}/subProjects?skip=${skip}&limit=${limit}`
        );
        dispatch(subProjectsRequest(promise));

        promise.then(
            function (subProjects) {
                const subData = {
                    subProjects: subProjects.data.data,

                    count: subProjects.data.count,
                    skip,
                    limit,
                };
                dispatch(subProjectsSuccess(subData));
            },
            function (error) {
                dispatch(subProjectsError(error));
            }
        );

        return promise;
    };
};

export const createSubProjectRequest = () => {
    return {
        type: types.CREATE_SUBPROJECT_REQUEST,
    };
};

export const createSubProjectError = (error: ErrorPayload) => {
    return {
        type: types.CREATE_SUBPROJECT_FAILED,
        payload: error,
    };
};

export const createSubProjectSuccess = (subProject: $TSFixMe) => {
    return {
        type: types.CREATE_SUBPROJECT_SUCCESS,
        payload: subProject,
    };
};

export const resetCreateSubProject = () => {
    return {
        type: types.CREATE_SUBPROJECT_RESET,
    };
};

export const resetCreateNewSubProject = () => {
    return {
        type: types.CREATE_NEW_SUBPROJECT_RESET,
    };
};

export const createNewSubProjectReset = () => {
    return function (dispatch: Dispatch) {
        dispatch(resetCreateNewSubProject());
    };
};

export function createSubProject(
    projectId: $TSFixMe,
    subProjectName: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(`project/${projectId}/subProject`, {
            subProjectName,
        });

        dispatch(createSubProjectRequest());

        return promise.then(
            function (subProject) {
                dispatch(createSubProjectSuccess(subProject.data));

                return subProject.data;
            },
            function (error) {
                dispatch(createSubProjectError(error));
                return { error };
            }
        );
    };
}

export const resetSubProjectTokenReset = () => {
    return {
        type: types.RESET_SUBPROJECT_TOKEN_RESET,
    };
};

export const resetSubProjectTokenRequest = () => {
    return {
        type: types.RESET_SUBPROJECT_TOKEN_REQUEST,
    };
};

export const resetSubProjectTokenSuccess = (subProject: $TSFixMe) => {
    return {
        type: types.RESET_SUBPROJECT_TOKEN_SUCCESS,
        payload: subProject.data,
    };
};

export const resetSubProjectTokenError = (error: ErrorPayload) => {
    return {
        type: types.RESET_SUBPROJECT_TOKEN_FAILED,
        payload: error,
    };
};

export const resetSubProjectKeyReset = () => {
    return function (dispatch: Dispatch) {
        dispatch(resetSubProjectTokenReset());
    };
};

export const resetSubProjectToken = (subProjectId: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(`project/${subProjectId}/resetToken`);

        dispatch(resetSubProjectTokenRequest());

        promise.then(
            function (subProject) {
                dispatch(resetSubProjectTokenSuccess(subProject));
            },
            function (error) {
                dispatch(resetSubProjectTokenError(error));
            }
        );

        return promise;
    };
};

export const renameSubProjectReset = () => {
    return {
        type: types.RENAME_SUBPROJECT_RESET,
    };
};

export const renameSubProjectRequest = () => {
    return {
        type: types.RENAME_SUBPROJECT_REQUEST,
    };
};

export const renameSubProjectSuccess = (project: $TSFixMe) => {
    return {
        type: types.RENAME_SUBPROJECT_SUCCESS,
        payload: project.data,
    };
};

export const renameSubProjectError = (error: ErrorPayload) => {
    return {
        type: types.RENAME_SUBPROJECT_FAILED,
        payload: error,
    };
};

export const resetRenameSubProject = () => {
    return function (dispatch: Dispatch) {
        dispatch(renameSubProjectReset());
    };
};

export function renameSubProject(
    projectId: $TSFixMe,
    subProjectId: $TSFixMe,
    subProjectName: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(`project/${projectId}/${subProjectId}`, {
            subProjectName,
        });

        dispatch(renameSubProjectRequest());

        promise.then(
            function (project) {
                dispatch(renameSubProjectSuccess(project));
                return project;
            },
            function (error) {
                dispatch(renameSubProjectError(error));
                return { error };
            }
        );
        return promise;
    };
}

export const deleteSubProjectRequest = () => {
    return {
        type: types.DELETE_SUBPROJECT_REQUEST,
    };
};

export const deleteSubProjectSuccess = (subProjectId: $TSFixMe) => {
    return {
        type: types.DELETE_SUBPROJECT_SUCCESS,
        payload: subProjectId,
    };
};

export const deleteSubProjectError = (error: ErrorPayload) => {
    return {
        type: types.DELETE_SUBPROJECT_FAILED,
        payload: error,
    };
};

export const deleteSubProjectReset = () => {
    return {
        type: types.DELETE_SUBPROJECT_RESET,
    };
};

export const resetDeleteSubProject = () => {
    return function (dispatch: Dispatch) {
        dispatch(deleteSubProjectReset());
    };
};

export const deleteSubProject = (
    projectId: $TSFixMe,
    subProjectId: $TSFixMe
) => {
    return function (dispatch: Dispatch) {
        const promise = delete (`project/${projectId}/${subProjectId}`,
        {
            subProjectId,
        });

        dispatch(deleteSubProjectRequest());

        promise.then(
            function () {
                dispatch(setActiveSubProject(projectId, true));
                dispatch(deleteSubProjectSuccess(subProjectId));
                return subProjectId;
            },
            function (error) {
                dispatch(deleteSubProjectError(error));
                return { error };
            }
        );

        return promise;
    };
};

// Calls the API to delete team member.

export const exitSubProjectRequest = () => {
    return {
        type: types.EXIT_SUBPROJECT_REQUEST,
    };
};

export const exitSubProjectSuccess = (userId: $TSFixMe) => {
    return {
        type: types.EXIT_SUBPROJECT_SUCCESS,
        payload: userId,
    };
};

export const exitSubProjectError = (error: ErrorPayload) => {
    return {
        type: types.EXIT_SUBPROJECT_FAILED,
        payload: error,
    };
};

export function exitSubProject(
    projectId: $TSFixMe,
    subProjectId: $TSFixMe,
    userId: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise =
            delete (`subProject/${projectId}/${subProjectId}/user/${userId}/exitSubProject`,
            null);
        dispatch(exitSubProjectRequest());

        promise.then(
            function () {
                dispatch(exitSubProjectSuccess({ projectId, userId }));
            },
            function (error) {
                dispatch(exitSubProjectError(error));
            }
        );

        return promise;
    };
}

export const changeSubProjectRoles = (team: $TSFixMe) => {
    return {
        type: types.CHANGE_SUBPROJECT_ROLES,
        payload: team,
    };
};

// Calls API to mark project for removal
export const markSubProjectForDeleteRequest = () => {
    return {
        type: types.MARK_SUBPROJECT_DELETE_REQUEST,
    };
};

export const markSubProjectForDeleteSuccess = (subProjectId: $TSFixMe) => {
    return {
        type: types.MARK_SUBPROJECT_DELETE_SUCCESS,
        payload: subProjectId,
    };
};

export const markSubProjectForDeleteError = (error: ErrorPayload) => {
    return {
        type: types.MARK_SUBPROJECT_DELETE_FAILED,
        payload: error,
    };
};

export function markSubProjectForDelete(
    projectId: $TSFixMe,
    subProjectId: $TSFixMe,
    feedback: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise =
            delete (`subProject/${projectId}/${subProjectId}/deleteProject`,
            { subProjectId, feedback });

        dispatch(markSubProjectForDeleteRequest());

        promise.then(
            function () {
                dispatch(markSubProjectForDeleteSuccess(projectId));
            },
            function (error) {
                dispatch(markSubProjectForDeleteError(error));
            }
        );

        return promise;
    };
}

export function setActiveSubProject(
    subproject: $TSFixMe,
    updateStorage = false
) {
    if (updateStorage) {
        // store to localstorage
        User.setActiveSubProjectId(subproject);
    }

    return {
        type: types.SET_ACTIVE_SUBPROJECT,
        payload: subproject,
    };
}
