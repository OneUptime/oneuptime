import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/subProject';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import { User } from '../config';

export const subProjectsRequest = (promise: $TSFixMe): void => {
    return {
        type: types.SUBPROJECTS_REQUEST,
        payload: promise,
    };
};

export const subProjectsError = (error: ErrorPayload): void => {
    return {
        type: types.SUBPROJECTS_FAILED,
        payload: error,
    };
};

export const subProjectsSuccess = (subProjects: $TSFixMe): void => {
    return {
        type: types.SUBPROJECTS_SUCCESS,
        payload: subProjects,
    };
};

export const resetSubProjects = (): void => {
    return {
        type: types.SUBPROJECTS_RESET,
    };
};

export const getSubProjects = (projectId: string, skip = 0, limit = 10): void => {
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

export const createSubProjectRequest = (): void => {
    return {
        type: types.CREATE_SUBPROJECT_REQUEST,
    };
};

export const createSubProjectError = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_SUBPROJECT_FAILED,
        payload: error,
    };
};

export const createSubProjectSuccess = (subProject: $TSFixMe): void => {
    return {
        type: types.CREATE_SUBPROJECT_SUCCESS,
        payload: subProject,
    };
};

export const resetCreateSubProject = (): void => {
    return {
        type: types.CREATE_SUBPROJECT_RESET,
    };
};

export const resetCreateNewSubProject = (): void => {
    return {
        type: types.CREATE_NEW_SUBPROJECT_RESET,
    };
};

export const createNewSubProjectReset = (): void => {
    return function (dispatch: Dispatch) {
        dispatch(resetCreateNewSubProject());
    };
};

export function createSubProject(projectId: string, subProjectName: $TSFixMe) {
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

export const resetSubProjectTokenReset = (): void => {
    return {
        type: types.RESET_SUBPROJECT_TOKEN_RESET,
    };
};

export const resetSubProjectTokenRequest = (): void => {
    return {
        type: types.RESET_SUBPROJECT_TOKEN_REQUEST,
    };
};

export const resetSubProjectTokenSuccess = (subProject: $TSFixMe): void => {
    return {
        type: types.RESET_SUBPROJECT_TOKEN_SUCCESS,
        payload: subProject.data,
    };
};

export const resetSubProjectTokenError = (error: ErrorPayload): void => {
    return {
        type: types.RESET_SUBPROJECT_TOKEN_FAILED,
        payload: error,
    };
};

export const resetSubProjectKeyReset = (): void => {
    return function (dispatch: Dispatch) {
        dispatch(resetSubProjectTokenReset());
    };
};

export const resetSubProjectToken = (subProjectId: string): void => {
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

export const renameSubProjectReset = (): void => {
    return {
        type: types.RENAME_SUBPROJECT_RESET,
    };
};

export const renameSubProjectRequest = (): void => {
    return {
        type: types.RENAME_SUBPROJECT_REQUEST,
    };
};

export const renameSubProjectSuccess = (project: $TSFixMe): void => {
    return {
        type: types.RENAME_SUBPROJECT_SUCCESS,
        payload: project.data,
    };
};

export const renameSubProjectError = (error: ErrorPayload): void => {
    return {
        type: types.RENAME_SUBPROJECT_FAILED,
        payload: error,
    };
};

export const resetRenameSubProject = (): void => {
    return function (dispatch: Dispatch) {
        dispatch(renameSubProjectReset());
    };
};

export function renameSubProject(
    projectId: string,
    subProjectId: string,
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

export const deleteSubProjectRequest = (): void => {
    return {
        type: types.DELETE_SUBPROJECT_REQUEST,
    };
};

export const deleteSubProjectSuccess = (subProjectId: string): void => {
    return {
        type: types.DELETE_SUBPROJECT_SUCCESS,
        payload: subProjectId,
    };
};

export const deleteSubProjectError = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_SUBPROJECT_FAILED,
        payload: error,
    };
};

export const deleteSubProjectReset = (): void => {
    return {
        type: types.DELETE_SUBPROJECT_RESET,
    };
};

export const resetDeleteSubProject = (): void => {
    return function (dispatch: Dispatch) {
        dispatch(deleteSubProjectReset());
    };
};

export const deleteSubProject = (projectId: string, subProjectId: string): void => {
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

export const exitSubProjectRequest = (): void => {
    return {
        type: types.EXIT_SUBPROJECT_REQUEST,
    };
};

export const exitSubProjectSuccess = (userId: string): void => {
    return {
        type: types.EXIT_SUBPROJECT_SUCCESS,
        payload: userId,
    };
};

export const exitSubProjectError = (error: ErrorPayload): void => {
    return {
        type: types.EXIT_SUBPROJECT_FAILED,
        payload: error,
    };
};

export function exitSubProject(
    projectId: string,
    subProjectId: string,
    userId: string
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

export const changeSubProjectRoles = (team: $TSFixMe): void => {
    return {
        type: types.CHANGE_SUBPROJECT_ROLES,
        payload: team,
    };
};

// Calls API to mark project for removal
export const markSubProjectForDeleteRequest = (): void => {
    return {
        type: types.MARK_SUBPROJECT_DELETE_REQUEST,
    };
};

export const markSubProjectForDeleteSuccess = (subProjectId: string): void => {
    return {
        type: types.MARK_SUBPROJECT_DELETE_SUCCESS,
        payload: subProjectId,
    };
};

export const markSubProjectForDeleteError = (error: ErrorPayload): void => {
    return {
        type: types.MARK_SUBPROJECT_DELETE_FAILED,
        payload: error,
    };
};

export function markSubProjectForDelete(
    projectId: string,
    subProjectId: string,
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
        User.setActivesubProjectId(subproject);
    }

    return {
        type: types.SET_ACTIVE_SUBPROJECT,
        payload: subproject,
    };
}
