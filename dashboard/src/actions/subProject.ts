import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/subProject';
import errors from '../errors';
import { User } from '../config';

export function subProjectsRequest(promise: $TSFixMe) {
    return {
        type: types.SUBPROJECTS_REQUEST,
        payload: promise,
    };
}

export function subProjectsError(error: $TSFixMe) {
    return {
        type: types.SUBPROJECTS_FAILED,
        payload: error,
    };
}

export function subProjectsSuccess(subProjects: $TSFixMe) {
    return {
        type: types.SUBPROJECTS_SUCCESS,
        payload: subProjects,
    };
}

export const resetSubProjects = () => {
    return {
        type: types.SUBPROJECTS_RESET,
    };
};

export function getSubProjects(projectId: $TSFixMe, skip = 0, limit = 10) {
    return function(dispatch: $TSFixMe) {
        const promise = getApi(
            `project/${projectId}/subProjects?skip=${skip}&limit=${limit}`
        );
        dispatch(subProjectsRequest(promise));

        promise.then(
            function(subProjects) {
                const subData = {
                    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                    subProjects: subProjects.data.data,
                    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                    count: subProjects.data.count,
                    skip,
                    limit,
                };
                dispatch(subProjectsSuccess(subData));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(subProjectsError(errors(error)));
            }
        );

        return promise;
    };
}

export function createSubProjectRequest() {
    return {
        type: types.CREATE_SUBPROJECT_REQUEST,
    };
}

export function createSubProjectError(error: $TSFixMe) {
    return {
        type: types.CREATE_SUBPROJECT_FAILED,
        payload: error,
    };
}

export function createSubProjectSuccess(subProject: $TSFixMe) {
    return {
        type: types.CREATE_SUBPROJECT_SUCCESS,
        payload: subProject,
    };
}

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

export function createNewSubProjectReset() {
    return function(dispatch: $TSFixMe) {
        dispatch(resetCreateNewSubProject());
    };
}

export function createSubProject(
    projectId: $TSFixMe,
    subProjectName: $TSFixMe
) {
    return function(dispatch: $TSFixMe) {
        const promise = postApi(`project/${projectId}/subProject`, {
            subProjectName,
        });

        dispatch(createSubProjectRequest());

        return promise.then(
            function(subProject) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(createSubProjectSuccess(subProject.data));
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                return subProject.data;
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(createSubProjectError(errors(error)));
                return { error };
            }
        );
    };
}

export function resetSubProjectTokenReset() {
    return {
        type: types.RESET_SUBPROJECT_TOKEN_RESET,
    };
}

export function resetSubProjectTokenRequest() {
    return {
        type: types.RESET_SUBPROJECT_TOKEN_REQUEST,
    };
}

export function resetSubProjectTokenSuccess(subProject: $TSFixMe) {
    return {
        type: types.RESET_SUBPROJECT_TOKEN_SUCCESS,
        payload: subProject.data,
    };
}

export function resetSubProjectTokenError(error: $TSFixMe) {
    return {
        type: types.RESET_SUBPROJECT_TOKEN_FAILED,
        payload: error,
    };
}

export function resetSubProjectKeyReset() {
    return function(dispatch: $TSFixMe) {
        dispatch(resetSubProjectTokenReset());
    };
}

export function resetSubProjectToken(subProjectId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = getApi(`project/${subProjectId}/resetToken`);

        dispatch(resetSubProjectTokenRequest());

        promise.then(
            function(subProject) {
                dispatch(resetSubProjectTokenSuccess(subProject));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(resetSubProjectTokenError(errors(error)));
            }
        );

        return promise;
    };
}

export function renameSubProjectReset() {
    return {
        type: types.RENAME_SUBPROJECT_RESET,
    };
}

export function renameSubProjectRequest() {
    return {
        type: types.RENAME_SUBPROJECT_REQUEST,
    };
}

export function renameSubProjectSuccess(project: $TSFixMe) {
    return {
        type: types.RENAME_SUBPROJECT_SUCCESS,
        payload: project.data,
    };
}

export function renameSubProjectError(error: $TSFixMe) {
    return {
        type: types.RENAME_SUBPROJECT_FAILED,
        payload: error,
    };
}

export function resetRenameSubProject() {
    return function(dispatch: $TSFixMe) {
        dispatch(renameSubProjectReset());
    };
}

export function renameSubProject(
    projectId: $TSFixMe,
    subProjectId: $TSFixMe,
    subProjectName: $TSFixMe
) {
    return function(dispatch: $TSFixMe) {
        const promise = putApi(`project/${projectId}/${subProjectId}`, {
            subProjectName,
        });

        dispatch(renameSubProjectRequest());

        promise.then(
            function(project) {
                dispatch(renameSubProjectSuccess(project));
                return project;
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(renameSubProjectError(errors(error)));
                return { error };
            }
        );
        return promise;
    };
}

export function deleteSubProjectRequest() {
    return {
        type: types.DELETE_SUBPROJECT_REQUEST,
    };
}

export function deleteSubProjectSuccess(subProjectId: $TSFixMe) {
    return {
        type: types.DELETE_SUBPROJECT_SUCCESS,
        payload: subProjectId,
    };
}

export function deleteSubProjectError(error: $TSFixMe) {
    return {
        type: types.DELETE_SUBPROJECT_FAILED,
        payload: error,
    };
}

export function deleteSubProjectReset() {
    return {
        type: types.DELETE_SUBPROJECT_RESET,
    };
}

export function resetDeleteSubProject() {
    return function(dispatch: $TSFixMe) {
        dispatch(deleteSubProjectReset());
    };
}

export function deleteSubProject(projectId: $TSFixMe, subProjectId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = deleteApi(`project/${projectId}/${subProjectId}`, {
            subProjectId,
        });

        dispatch(deleteSubProjectRequest());

        promise.then(
            function() {
                dispatch(setActiveSubProject(projectId, true));
                dispatch(deleteSubProjectSuccess(subProjectId));
                return subProjectId;
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(deleteSubProjectError(errors(error)));
                return { error };
            }
        );

        return promise;
    };
}

// Calls the API to delete team member.

export function exitSubProjectRequest() {
    return {
        type: types.EXIT_SUBPROJECT_REQUEST,
    };
}

export function exitSubProjectSuccess(userId: $TSFixMe) {
    return {
        type: types.EXIT_SUBPROJECT_SUCCESS,
        payload: userId,
    };
}

export function exitSubProjectError(error: $TSFixMe) {
    return {
        type: types.EXIT_SUBPROJECT_FAILED,
        payload: error,
    };
}

export function exitSubProject(
    projectId: $TSFixMe,
    subProjectId: $TSFixMe,
    userId: $TSFixMe
) {
    return function(dispatch: $TSFixMe) {
        const promise = deleteApi(
            `subProject/${projectId}/${subProjectId}/user/${userId}/exitSubProject`,
            null
        );
        dispatch(exitSubProjectRequest());

        promise.then(
            function() {
                dispatch(exitSubProjectSuccess({ projectId, userId }));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(exitSubProjectError(errors(error)));
            }
        );

        return promise;
    };
}

export function changeSubProjectRoles(team: $TSFixMe) {
    return {
        type: types.CHANGE_SUBPROJECT_ROLES,
        payload: team,
    };
}

// Calls API to mark project for removal
export function markSubProjectForDeleteRequest() {
    return {
        type: types.MARK_SUBPROJECT_DELETE_REQUEST,
    };
}

export function markSubProjectForDeleteSuccess(subProjectId: $TSFixMe) {
    return {
        type: types.MARK_SUBPROJECT_DELETE_SUCCESS,
        payload: subProjectId,
    };
}

export function markSubProjectForDeleteError(error: $TSFixMe) {
    return {
        type: types.MARK_SUBPROJECT_DELETE_FAILED,
        payload: error,
    };
}

export function markSubProjectForDelete(
    projectId: $TSFixMe,
    subProjectId: $TSFixMe,
    feedback: $TSFixMe
) {
    return function(dispatch: $TSFixMe) {
        const promise = deleteApi(
            `subProject/${projectId}/${subProjectId}/deleteProject`,
            { subProjectId, feedback }
        );

        dispatch(markSubProjectForDeleteRequest());

        promise.then(
            function() {
                dispatch(markSubProjectForDeleteSuccess(projectId));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(markSubProjectForDeleteError(errors(error)));
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
