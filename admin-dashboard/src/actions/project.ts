import { getApi, putApi, deleteApi, postApi } from '../api';
import * as types from '../constants/project';
import errors from '../errors';

// Fetch Projects

export const fetchProjectsRequest = () => {
    return {
        type: types.FETCH_PROJECTS_REQUEST,
    };
};

export const fetchProjectsSuccess = (projects: $TSFixMe) => {
    return {
        type: types.FETCH_PROJECTS_SUCCESS,
        payload: projects,
    };
};

export const fetchProjectsError = (error: $TSFixMe) => {
    return {
        type: types.FETCH_PROJECTS_FAILURE,
        payload: error,
    };
};

// Calls the API to fetch all projects.
export const fetchProjects = (skip: $TSFixMe, limit: $TSFixMe) => async (
    dispatch: $TSFixMe
) => {
    skip = skip || 0;
    limit = limit || 10;

    dispatch(fetchProjectsRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await getApi(
            `project/projects/allProjects?skip=${skip}&limit=${limit}`
        );

        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        dispatch(fetchProjectsSuccess(response.data));
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
        dispatch(fetchProjectsError(errors(errorMsg)));
    }
};

export const fetchProjectRequest = () => {
    return {
        type: types.FETCH_PROJECT_REQUEST,
    };
};

export const fetchProjectSuccess = (project: $TSFixMe) => {
    return {
        type: types.FETCH_PROJECT_SUCCESS,
        payload: project,
    };
};

export const fetchProjectError = (error: $TSFixMe) => {
    return {
        type: types.FETCH_PROJECT_FAILURE,
        payload: error,
    };
};

// Calls the API to fetch a project.
export const fetchProject = (slug: $TSFixMe) => async (dispatch: $TSFixMe) => {
    dispatch(fetchProjectRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await getApi(`project/projects/${slug}`);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        const projects = response.data;

        dispatch(fetchProjectSuccess(projects));
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
        dispatch(fetchProjectError(errors(errorMsg)));
    }
};

// Team create
export function userCreateRequest() {
    return {
        type: types.USER_CREATE_REQUEST,
    };
}

export function userCreateSuccess(team: $TSFixMe) {
    return {
        type: types.USER_CREATE_SUCCESS,
        payload: team,
    };
}

export function userCreateError(error: $TSFixMe) {
    return {
        type: types.USER_CREATE_FAILURE,
        payload: error,
    };
}

// Calls the API to add users to project.
export function userCreate(projectId: $TSFixMe, values: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        const promise = postApi(`team/${projectId}`, values);
        dispatch(userCreateRequest());
        promise.then(
            function(response) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                const data = response.data;
                const projectUsers = data.filter(
                    (team: $TSFixMe) => team.projectId === projectId
                )[0];
                dispatch(userCreateSuccess(projectUsers.team));
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
                dispatch(userCreateError(errors(error)));
            }
        );

        return promise;
    };
}

export const fetchUserProjectsRequest = () => {
    return {
        type: types.FETCH_USER_PROJECTS_REQUEST,
    };
};

export const fetchUserProjectsSuccess = (users: $TSFixMe) => {
    return {
        type: types.FETCH_USER_PROJECTS_SUCCESS,
        payload: users,
    };
};

export const fetchUserProjectsError = (error: $TSFixMe) => {
    return {
        type: types.FETCH_USER_PROJECTS_FAILURE,
        payload: error,
    };
};

// Calls the API to fetch users belonging to a particular project
export const fetchProjectTeam = (projectId: $TSFixMe) => async (
    dispatch: $TSFixMe
) => {
    dispatch(fetchProjectTeamRequest());
    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await getApi(`team/${projectId}/teamMembers`);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        const team = response.data;
        const projectTeam = team.filter(
            (team: $TSFixMe) => team._id === projectId
        )[0];
        dispatch(fetchProjectTeamSuccess(projectTeam));
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
        dispatch(fetchProjectTeamError(errors(errorMsg)));
    }
};

export const fetchProjectTeamRequest = () => {
    return {
        type: types.FETCH_PROJECT_TEAM_REQUEST,
    };
};

export const fetchProjectTeamSuccess = (payload: $TSFixMe) => {
    return {
        type: types.FETCH_PROJECT_TEAM_SUCCESS,
        payload,
    };
};

export const fetchProjectTeamError = (error: $TSFixMe) => {
    return {
        type: types.FETCH_PROJECT_TEAM_ERROR,
        payload: error,
    };
};
export function userUpdateRoleRequest(id: $TSFixMe) {
    return {
        type: types.USER_UPDATE_ROLE_REQUEST,
        payload: id,
    };
}

export function userUpdateRoleSuccess(team: $TSFixMe) {
    return {
        type: types.USER_UPDATE_ROLE_SUCCESS,
        payload: team,
    };
}

export function userUpdateRoleError(error: $TSFixMe) {
    return {
        type: types.USER_UPDATE_ROLE_FAILURE,
        payload: error,
    };
}

export function changeUserProjectRole(team: $TSFixMe) {
    return {
        type: types.CHANGE_USER_PROJECT_ROLES,
        payload: team,
    };
}
// Calls the API to update user role.
export function userUpdateRole(projectId: $TSFixMe, values: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = putApi(
            `team/${projectId}/${values.teamMemberId}/changerole`,
            values
        );
        dispatch(userUpdateRoleRequest(values.teamMemberId));

        promise.then(
            function(response) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                const data = response.data;
                const projectUsers = data.filter(
                    (user: $TSFixMe) => user.projectId === projectId
                )[0];
                dispatch(userUpdateRoleSuccess(projectUsers));
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
                dispatch(userUpdateRoleError(errors(error)));
            }
        );

        return promise;
    };
}

//userlist pagination
export function paginateNext() {
    return {
        type: types.PAGINATE_USERS_NEXT,
    };
}

export function paginatePrev() {
    return {
        type: types.PAGINATE_USERS_PREV,
    };
}

export function paginate(type: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        type === 'next' && dispatch(paginateNext());
        type === 'prev' && dispatch(paginatePrev());
    };
}

//Add Balance to a project
export const updateBalance = (
    projectId: $TSFixMe,
    rechargeBalanceAmount: $TSFixMe
) => async (dispatch: $TSFixMe) => {
    dispatch(updateProjectBalanceRequest());

    try {
        const response = await putApi(`project/${projectId}/updateBalance`, {
            rechargeBalanceAmount,
        });
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        const data = response.data;
        dispatch(updateProjectBalanceSuccess(data));
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
        dispatch(updateProjectBalanceError(errors(errorMsg)));
    }
};

export function updateProjectBalanceRequest() {
    return {
        type: types.PROJECT_BALANCE_UPDATE_REQUEST,
    };
}

export function updateProjectBalanceSuccess(project: $TSFixMe) {
    return {
        type: types.PROJECT_BALANCE_UPDATE_SUCCESS,
        payload: project,
    };
}

export function updateProjectBalanceError(error: $TSFixMe) {
    return {
        type: types.PROJECT_BALANCE_UPDATE_FAILURE,
        payload: error,
    };
}
// Calls the API to delete user from project
export function teamDelete(projectId: $TSFixMe, teamMemberId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = deleteApi(`team/${projectId}/${teamMemberId}`, null);
        dispatch(teamDeleteRequest(teamMemberId));

        promise.then(
            function(response) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                const team = response.data;
                const projectTeam = team.filter(
                    (team: $TSFixMe) => team.projectId === projectId
                )[0];
                dispatch(teamDeleteSuccess(projectTeam.team));
                return { team };
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
                dispatch(teamDeleteError(errors(error)));
                return { error };
            }
        );

        return promise;
    };
}

export function teamDeleteRequest(id: $TSFixMe) {
    return {
        type: types.TEAM_DELETE_REQUEST,
        payload: id,
    };
}
export function teamDeleteSuccess(team: $TSFixMe) {
    return {
        type: types.TEAM_DELETE_SUCCESS,
        payload: team,
    };
}

export function teamDeleteError(error: $TSFixMe) {
    return {
        type: types.TEAM_DELETE_FAILURE,
        payload: error,
    };
}

export function teamDeleteReset() {
    return {
        type: types.TEAM_DELETE_RESET,
    };
}
export function resetTeamDelete() {
    return function(dispatch: $TSFixMe) {
        dispatch(teamDeleteReset());
    };
}

// Calls the API to fetch all user projects.
export const fetchUserProjects = (
    userId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) => async (dispatch: $TSFixMe) => {
    skip = skip ? parseInt(skip) : 0;
    limit = limit ? parseInt(limit) : 10;

    dispatch(fetchUserProjectsRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await getApi(
            `project/projects/user/${userId}?skip=${skip}&limit=${limit}`
        );
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        const users = response.data;

        dispatch(fetchUserProjectsSuccess(users));
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
        dispatch(fetchUserProjectsError(errors(errorMsg)));
    }
};

//Delete project
export const deleteProjectRequest = () => {
    return {
        type: types.DELETE_PROJECT_REQUEST,
    };
};

export const deleteProjectReset = () => {
    return {
        type: types.DELETE_PROJECT_RESET,
    };
};

export const deleteProjectSuccess = (project: $TSFixMe) => {
    return {
        type: types.DELETE_PROJECT_SUCCESS,
        payload: project,
    };
};

export const deleteProjectError = (error: $TSFixMe) => {
    return {
        type: types.DELETE_PROJECT_FAILED,
        payload: error,
    };
};

// Calls the API to delete a project
export const deleteProject = (projectId: $TSFixMe) => async (
    dispatch: $TSFixMe
) => {
    dispatch(deleteProjectRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await deleteApi(`project/${projectId}/deleteProject`);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        const data = response.data;

        dispatch(deleteProjectSuccess(data));
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
        dispatch(deleteProjectError(errors(errorMsg)));
    }
};

//Block project
export const blockProjectRequest = () => {
    return {
        type: types.BLOCK_PROJECT_REQUEST,
    };
};

export const blockProjectReset = () => {
    return {
        type: types.BLOCK_PROJECT_RESET,
    };
};

export const blockProjectSuccess = (project: $TSFixMe) => {
    return {
        type: types.BLOCK_PROJECT_SUCCESS,
        payload: project,
    };
};

export const blockProjectError = (error: $TSFixMe) => {
    return {
        type: types.BLOCK_PROJECT_FAILED,
        payload: error,
    };
};

// Calls the API to block a project
export const blockProject = (projectId: $TSFixMe) => async (
    dispatch: $TSFixMe
) => {
    dispatch(blockProjectRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await putApi(`project/${projectId}/blockProject`);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        const data = response.data;

        dispatch(blockProjectSuccess(data));
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
        dispatch(blockProjectError(errors(errorMsg)));
    }
};

//Renew Alert Limit
export const renewAlertLimitRequest = () => {
    return {
        type: types.ALERT_LIMIT_REQUEST,
    };
};

export const renewAlertLimitReset = () => {
    return {
        type: types.ALERT_LIMIT_RESET,
    };
};

export const renewAlertLimitSuccess = (project: $TSFixMe) => {
    return {
        type: types.ALERT_LIMIT_SUCCESS,
        payload: project,
    };
};

export const renewAlertLimitError = (error: $TSFixMe) => {
    return {
        type: types.ALERT_LIMIT_FAILED,
        payload: error,
    };
};

// Calls the API to block a project
export const renewAlertLimit = (
    projectId: $TSFixMe,
    alertLimit: $TSFixMe
) => async (dispatch: $TSFixMe) => {
    dispatch(renewAlertLimitRequest());

    try {
        const response = await putApi(`project/${projectId}/renewAlertLimit`, {
            alertLimit,
        });
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        const data = response.data;

        dispatch(renewAlertLimitSuccess(data));
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
        dispatch(renewAlertLimitError(errors(errorMsg)));
    }
};

//Restore project
export const restoreProjectRequest = () => {
    return {
        type: types.RESTORE_PROJECT_REQUEST,
    };
};

export const restoreProjectReset = () => {
    return {
        type: types.RESTORE_PROJECT_RESET,
    };
};

export const restoreProjectSuccess = (project: $TSFixMe) => {
    return {
        type: types.RESTORE_PROJECT_SUCCESS,
        payload: project,
    };
};

export const restoreProjectError = (error: $TSFixMe) => {
    return {
        type: types.RESTORE_PROJECT_FAILED,
        payload: error,
    };
};

// Calls the API to restore a project
export const restoreProject = (projectId: $TSFixMe) => async (
    dispatch: $TSFixMe
) => {
    dispatch(restoreProjectRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await putApi(`project/${projectId}/restoreProject`);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        const data = response.data;

        dispatch(restoreProjectSuccess(data));
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
        dispatch(restoreProjectError(errors(errorMsg)));
    }
};

//Unblock project
export const unblockProjectRequest = () => {
    return {
        type: types.UNBLOCK_PROJECT_REQUEST,
    };
};

export const unblockProjectReset = () => {
    return {
        type: types.UNBLOCK_PROJECT_RESET,
    };
};

export const unblockProjectSuccess = (project: $TSFixMe) => {
    return {
        type: types.UNBLOCK_PROJECT_SUCCESS,
        payload: project,
    };
};

export const unblockProjectError = (error: $TSFixMe) => {
    return {
        type: types.UNBLOCK_PROJECT_FAILED,
        payload: error,
    };
};

// Calls the API to un-block a project
export const unblockProject = (projectId: $TSFixMe) => async (
    dispatch: $TSFixMe
) => {
    dispatch(unblockProjectRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await putApi(`project/${projectId}/unblockProject`);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        const data = response.data;

        dispatch(unblockProjectSuccess(data));
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
        dispatch(unblockProjectError(errors(errorMsg)));
    }
};

//Add Project Notes
export const addProjectNoteRequest = () => {
    return {
        type: types.ADD_PROJECT_NOTE_REQUEST,
    };
};

export const addProjectNoteReset = () => {
    return {
        type: types.ADD_PROJECT_NOTE_RESET,
    };
};

export const addProjectNoteSuccess = (projectNote: $TSFixMe) => {
    return {
        type: types.ADD_PROJECT_NOTE_SUCCESS,
        payload: projectNote,
    };
};

export const addProjectNoteError = (error: $TSFixMe) => {
    return {
        type: types.ADD_PROJECT_NOTE_FAILURE,
        payload: error,
    };
};

// Calls the API to add Admin Note
export const addProjectNote = (projectId: $TSFixMe, values: $TSFixMe) => async (
    dispatch: $TSFixMe
) => {
    dispatch(addProjectNoteRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        const response = await postApi(`project/${projectId}/addNote`, values);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        const data = response.data;

        dispatch(addProjectNoteSuccess(data));
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
        dispatch(addProjectNoteError(errors(errorMsg)));
    }
};

//Search Projects
export const searchProjectsRequest = () => {
    return {
        type: types.SEARCH_PROJECTS_REQUEST,
    };
};

export const searchProjectsReset = () => {
    return {
        type: types.SEARCH_PROJECTS_RESET,
    };
};

export const searchProjectsSuccess = (projects: $TSFixMe) => {
    return {
        type: types.SEARCH_PROJECTS_SUCCESS,
        payload: projects,
    };
};

export const searchProjectsError = (error: $TSFixMe) => {
    return {
        type: types.SEARCH_PROJECTS_FAILURE,
        payload: error,
    };
};

// Calls the search projects api
export const searchProjects = (
    filter: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) => async (dispatch: $TSFixMe) => {
    const values = {
        filter,
    };

    dispatch(searchProjectsRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        const response = await postApi(
            `project/projects/search?skip=${skip}&limit=${limit}`,
            values
        );
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        const data = response.data;

        dispatch(searchProjectsSuccess(data));
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
        dispatch(searchProjectsError(errors(errorMsg)));
    }
};

// Upgrade a Project
export const changePlanRequest = () => {
    return {
        type: types.CHANGE_PLAN_REQUEST,
    };
};

export const changePlanSuccess = (payload: $TSFixMe) => {
    return {
        type: types.CHANGE_PLAN_SUCCESS,
        payload,
    };
};

export const changePlanFailure = (error: $TSFixMe) => {
    return {
        type: types.CHANGE_PLAN_FAILURE,
        payload: error,
    };
};

export const changePlan = (
    projectId: $TSFixMe,
    planId: $TSFixMe,
    projectName: $TSFixMe,
    oldPlan: $TSFixMe,
    newPlan: $TSFixMe
) => async (dispatch: $TSFixMe) => {
    dispatch(changePlanRequest());

    try {
        const response = await putApi(`project/${projectId}/admin/changePlan`, {
            projectName,
            planId,
            oldPlan,
            newPlan,
        });
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        dispatch(changePlanSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(changePlanFailure(errorMsg));
    }
};

export function fetchProjectDomainsRequest() {
    return {
        type: types.PROJECT_DOMAIN_REQUEST,
    };
}

export function fetchProjectDomainsSuccess(payload: $TSFixMe) {
    return {
        type: types.PROJECT_DOMAIN_SUCCESS,
        payload,
    };
}

export function fetchProjectDomainsFailure(error: $TSFixMe) {
    return {
        type: types.PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
}

export function fetchProjectDomains(projectId: $TSFixMe, skip = 0, limit = 10) {
    return async function(dispatch: $TSFixMe) {
        dispatch(fetchProjectDomainsRequest());

        try {
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
            const response = await getApi(
                `domainVerificationToken/${projectId}/domains?skip=${skip}&limit=${limit}`
            );
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            dispatch(fetchProjectDomainsSuccess(response.data));
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            return response.data;
        } catch (error) {
            const errorMessage =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(fetchProjectDomainsFailure(errorMessage));
        }
    };
}

export function deleteProjectDomainRequest() {
    return {
        type: types.DELETE_PROJECT_DOMAIN_REQUEST,
    };
}

export function deleteProjectDomainSuccess(payload: $TSFixMe) {
    return {
        type: types.DELETE_PROJECT_DOMAIN_SUCCESS,
        payload,
    };
}

export function deleteProjectDomainFailure(error: $TSFixMe) {
    return {
        type: types.DELETE_PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
}

export function resetDeleteProjectDomain() {
    return {
        type: types.RESET_DELETE_PROJECT_DOMAIN,
    };
}

export function deleteProjectDomain({ projectId, domainId }: $TSFixMe) {
    return async function(dispatch: $TSFixMe) {
        dispatch(deleteProjectDomainRequest());
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const promise = deleteApi(
            `domainVerificationToken/${projectId}/domain/${domainId}`
        );
        promise.then(
            function(response) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(deleteProjectDomainSuccess(response.data));
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                return response.data;
            },
            function(error) {
                const errorMessage =
                    error.response && error.response.data
                        ? error.response.data
                        : error.data
                        ? error.data
                        : error.message
                        ? error.message
                        : 'Network Error';
                dispatch(deleteProjectDomainFailure(errorMessage));
            }
        );
        return promise;
    };
}

export function verifyProjectDomainRequest() {
    return {
        type: types.VERIFY_PROJECT_DOMAIN_REQUEST,
    };
}

export function verifyProjectDomainSuccess(payload: $TSFixMe) {
    return {
        type: types.VERIFY_PROJECT_DOMAIN_SUCCESS,
        payload,
    };
}

export function verifyProjectDomainFailure(error: $TSFixMe) {
    return {
        type: types.VERIFY_PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
}

export function resetVerifyProjectDomain() {
    return {
        type: types.RESET_VERIFY_PROJECT_DOMAIN,
    };
}

export function verifyProjectDomain({ projectId, domainId }: $TSFixMe) {
    return async function(dispatch: $TSFixMe) {
        dispatch(verifyProjectDomainRequest());

        try {
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
            const response = await putApi(
                `domainVerificationToken/${projectId}/forceVerify/${domainId}`
            );
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            dispatch(verifyProjectDomainSuccess(response.data));
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            return response.data;
        } catch (error) {
            const errorMessage =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(verifyProjectDomainFailure(errorMessage));
        }
    };
}

export function unVerifyProjectDomainRequest() {
    return {
        type: types.UNVERIFY_PROJECT_DOMAIN_REQUEST,
    };
}

export function unVerifyProjectDomainSuccess(payload: $TSFixMe) {
    return {
        type: types.UNVERIFY_PROJECT_DOMAIN_SUCCESS,
        payload,
    };
}

export function unVerifyProjectDomainFailure(error: $TSFixMe) {
    return {
        type: types.UNVERIFY_PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
}

export function resetUnverifyProjectDomain() {
    return {
        type: types.RESET_UNVERIFY_PROJECT_DOMAIN,
    };
}

export function unVerifyProjectDomain(projectId: $TSFixMe, domainId: $TSFixMe) {
    return async function(dispatch: $TSFixMe) {
        dispatch(unVerifyProjectDomainRequest());

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const promise = putApi(
            `domainVerificationToken/${projectId}/unverify/${domainId}`
        );
        promise.then(
            function(response) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(unVerifyProjectDomainSuccess(response.data));
            },
            function(error) {
                const errorMessage =
                    error.response && error.response.data
                        ? error.response.data
                        : error.data
                        ? error.data
                        : error.message
                        ? error.message
                        : 'Network Error';
                dispatch(unVerifyProjectDomainFailure(errorMessage));
            }
        );
        return promise;
    };
}

export function resetProjectDomainRequest() {
    return {
        type: types.RESET_PROJECT_DOMAIN_REQUEST,
    };
}

export function resetProjectDomainSuccess(payload: $TSFixMe) {
    return {
        type: types.RESET_PROJECT_DOMAIN_SUCCESS,
        payload,
    };
}

export function resetProjectDomainFailure(error: $TSFixMe) {
    return {
        type: types.RESET_PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
}

export function resetProjectDomainOnMount() {
    return {
        type: types.RESET_PROJECT_DOMAIN_ON_MOUNT,
    };
}

export function resetProjectDomain(projectId: $TSFixMe, domainId: $TSFixMe) {
    return async function(dispatch: $TSFixMe) {
        dispatch(resetProjectDomainRequest());
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const promise = putApi(
            `domainVerificationToken/${projectId}/resetDomain/${domainId}`
        );
        promise.then(
            function(response) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(resetProjectDomainSuccess(response.data));
            },
            function(error) {
                const errorMessage =
                    error.response && error.response.data
                        ? error.response.data
                        : error.data
                        ? error.data
                        : error.message
                        ? error.message
                        : 'Network Error';
                dispatch(resetProjectDomainFailure(errorMessage));
            }
        );
        return promise;
    };
}
