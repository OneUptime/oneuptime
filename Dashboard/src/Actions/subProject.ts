import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/subProject';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import { User } from '../config';

export const subProjectsRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.SUBPROJECTS_REQUEST,
        payload: promise,
    };
};

export const subProjectsError: Function = (error: ErrorPayload): void => {
    return {
        type: types.SUBPROJECTS_FAILED,
        payload: error,
    };
};

export const subProjectsSuccess: Function = (subProjects: $TSFixMe): void => {
    return {
        type: types.SUBPROJECTS_SUCCESS,
        payload: subProjects,
    };
};

export const resetSubProjects: Function = (): void => {
    return {
        type: types.SUBPROJECTS_RESET,
    };
};

export const getSubProjects: Function = (
    projectId: ObjectID,
    skip = 0,
    limit = 10
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `project/${projectId}/subProjects?skip=${skip}&limit=${limit}`
        );
        dispatch(subProjectsRequest(promise));

        promise.then(
            (subProjects): void => {
                const subData: $TSFixMe = {
                    subProjects: subProjects.data.data,

                    count: subProjects.data.count,
                    skip,
                    limit,
                };
                dispatch(subProjectsSuccess(subData));
            },
            (error): void => {
                dispatch(subProjectsError(error));
            }
        );

        return promise;
    };
};

export const createSubProjectRequest: Function = (): void => {
    return {
        type: types.CREATE_SUBPROJECT_REQUEST,
    };
};

export const createSubProjectError: Function = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_SUBPROJECT_FAILED,
        payload: error,
    };
};

export const createSubProjectSuccess: Function = (
    subProject: $TSFixMe
): void => {
    return {
        type: types.CREATE_SUBPROJECT_SUCCESS,
        payload: subProject,
    };
};

export const resetCreateSubProject: Function = (): void => {
    return {
        type: types.CREATE_SUBPROJECT_RESET,
    };
};

export const resetCreateNewSubProject: Function = (): void => {
    return {
        type: types.CREATE_NEW_SUBPROJECT_RESET,
    };
};

export const createNewSubProjectReset: Function = (): void => {
    return function (dispatch: Dispatch): void {
        dispatch(resetCreateNewSubProject());
    };
};

export function createSubProject(
    projectId: ObjectID,
    subProjectName: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `project/${projectId}/subProject`,
            {
                subProjectName,
            }
        );

        dispatch(createSubProjectRequest());

        return promise.then(
            (subProject): void => {
                dispatch(createSubProjectSuccess(subProject.data));

                return subProject.data;
            },
            (error): void => {
                dispatch(createSubProjectError(error));
                return { error };
            }
        );
    };
}

export const resetSubProjectTokenReset: Function = (): void => {
    return {
        type: types.RESET_SUBPROJECT_TOKEN_RESET,
    };
};

export const resetSubProjectTokenRequest: Function = (): void => {
    return {
        type: types.RESET_SUBPROJECT_TOKEN_REQUEST,
    };
};

export const resetSubProjectTokenSuccess: Function = (
    subProject: $TSFixMe
): void => {
    return {
        type: types.RESET_SUBPROJECT_TOKEN_SUCCESS,
        payload: subProject.data,
    };
};

export const resetSubProjectTokenError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.RESET_SUBPROJECT_TOKEN_FAILED,
        payload: error,
    };
};

export const resetSubProjectKeyReset: Function = (): void => {
    return function (dispatch: Dispatch): void {
        dispatch(resetSubProjectTokenReset());
    };
};

export const resetSubProjectToken: Function = (
    subProjectId: ObjectID
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `project/${subProjectId}/resetToken`
        );

        dispatch(resetSubProjectTokenRequest());

        promise.then(
            (subProject): void => {
                dispatch(resetSubProjectTokenSuccess(subProject));
            },
            (error): void => {
                dispatch(resetSubProjectTokenError(error));
            }
        );

        return promise;
    };
};

export const renameSubProjectReset: Function = (): void => {
    return {
        type: types.RENAME_SUBPROJECT_RESET,
    };
};

export const renameSubProjectRequest: Function = (): void => {
    return {
        type: types.RENAME_SUBPROJECT_REQUEST,
    };
};

export const renameSubProjectSuccess: Function = (project: $TSFixMe): void => {
    return {
        type: types.RENAME_SUBPROJECT_SUCCESS,
        payload: project.data,
    };
};

export const renameSubProjectError: Function = (error: ErrorPayload): void => {
    return {
        type: types.RENAME_SUBPROJECT_FAILED,
        payload: error,
    };
};

export const resetRenameSubProject: Function = (): void => {
    return function (dispatch: Dispatch): void {
        dispatch(renameSubProjectReset());
    };
};

export function renameSubProject(
    projectId: ObjectID,
    subProjectId: ObjectID,
    subProjectName: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `project/${projectId}/${subProjectId}`,
            {
                subProjectName,
            }
        );

        dispatch(renameSubProjectRequest());

        promise.then(
            (project): void => {
                dispatch(renameSubProjectSuccess(project));
                return project;
            },
            (error): void => {
                dispatch(renameSubProjectError(error));
                return { error };
            }
        );
        return promise;
    };
}

export const deleteSubProjectRequest: Function = (): void => {
    return {
        type: types.DELETE_SUBPROJECT_REQUEST,
    };
};

export const deleteSubProjectSuccess: Function = (
    subProjectId: ObjectID
): void => {
    return {
        type: types.DELETE_SUBPROJECT_SUCCESS,
        payload: subProjectId,
    };
};

export const deleteSubProjectError: Function = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_SUBPROJECT_FAILED,
        payload: error,
    };
};

export const deleteSubProjectReset: Function = (): void => {
    return {
        type: types.DELETE_SUBPROJECT_RESET,
    };
};

export const resetDeleteSubProject: Function = (): void => {
    return function (dispatch: Dispatch): void {
        dispatch(deleteSubProjectReset());
    };
};

export const deleteSubProject: Function = (
    projectId: ObjectID,
    subProjectId: ObjectID
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe =
            delete (`project/${projectId}/${subProjectId}`,
            {
                subProjectId,
            });

        dispatch(deleteSubProjectRequest());

        promise.then(
            (): void => {
                dispatch(setActiveSubProject(projectId, true));
                dispatch(deleteSubProjectSuccess(subProjectId));
                return subProjectId;
            },
            (error): void => {
                dispatch(deleteSubProjectError(error));
                return { error };
            }
        );

        return promise;
    };
};

// Calls the API to delete team member.

export const exitSubProjectRequest: Function = (): void => {
    return {
        type: types.EXIT_SUBPROJECT_REQUEST,
    };
};

export const exitSubProjectSuccess: Function = (userId: ObjectID): void => {
    return {
        type: types.EXIT_SUBPROJECT_SUCCESS,
        payload: userId,
    };
};

export const exitSubProjectError: Function = (error: ErrorPayload): void => {
    return {
        type: types.EXIT_SUBPROJECT_FAILED,
        payload: error,
    };
};

export function exitSubProject(
    projectId: ObjectID,
    subProjectId: ObjectID,
    userId: ObjectID
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe =
            delete (`subProject/${projectId}/${subProjectId}/user/${userId}/exitSubProject`,
            null);
        dispatch(exitSubProjectRequest());

        promise.then(
            (): void => {
                dispatch(exitSubProjectSuccess({ projectId, userId }));
            },
            (error): void => {
                dispatch(exitSubProjectError(error));
            }
        );

        return promise;
    };
}

export const changeSubProjectRoles: Function = (team: $TSFixMe): void => {
    return {
        type: types.CHANGE_SUBPROJECT_ROLES,
        payload: team,
    };
};

// Calls API to mark project for removal
export const markSubProjectForDeleteRequest: Function = (): void => {
    return {
        type: types.MARK_SUBPROJECT_DELETE_REQUEST,
    };
};

export const markSubProjectForDeleteSuccess: Function = (
    subProjectId: ObjectID
): void => {
    return {
        type: types.MARK_SUBPROJECT_DELETE_SUCCESS,
        payload: subProjectId,
    };
};

export const markSubProjectForDeleteError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.MARK_SUBPROJECT_DELETE_FAILED,
        payload: error,
    };
};

export function markSubProjectForDelete(
    projectId: ObjectID,
    subProjectId: ObjectID,
    feedback: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe =
            delete (`subProject/${projectId}/${subProjectId}/deleteProject`,
            { subProjectId, feedback });

        dispatch(markSubProjectForDeleteRequest());

        promise.then(
            (): void => {
                dispatch(markSubProjectForDeleteSuccess(projectId));
            },
            (error): void => {
                dispatch(markSubProjectForDeleteError(error));
            }
        );

        return promise;
    };
}

export function setActiveSubProject(
    subproject: $TSFixMe,
    updateStorage = false
): void {
    if (updateStorage) {
        // store to localstorage
        User.setActivesubProjectId(subproject);
    }

    return {
        type: types.SET_ACTIVE_SUBPROJECT,
        payload: subproject,
    };
}
