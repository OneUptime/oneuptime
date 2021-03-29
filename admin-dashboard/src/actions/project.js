import { getApi, putApi, deleteApi, postApi } from '../api';
import * as types from '../constants/project';
import errors from '../errors';

// Fetch Projects

export const fetchProjectsRequest = () => {
    return {
        type: types.FETCH_PROJECTS_REQUEST,
    };
};

export const fetchProjectsSuccess = projects => {
    return {
        type: types.FETCH_PROJECTS_SUCCESS,
        payload: projects,
    };
};

export const fetchProjectsError = error => {
    return {
        type: types.FETCH_PROJECTS_FAILURE,
        payload: error,
    };
};

// Calls the API to fetch all projects.
export const fetchProjects = (skip, limit) => async dispatch => {
    skip = skip ?? 0;
    limit = limit ?? 10;

    dispatch(fetchProjectsRequest());

    try {
        const response = await getApi(
            `project/projects/allProjects?skip=${skip}&limit=${limit}`
        );

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

export const fetchProjectSuccess = project => {
    return {
        type: types.FETCH_PROJECT_SUCCESS,
        payload: project,
    };
};

export const fetchProjectError = error => {
    return {
        type: types.FETCH_PROJECT_FAILURE,
        payload: error,
    };
};

// Calls the API to fetch a project.
export const fetchProject = projectId => async dispatch => {
    dispatch(fetchProjectRequest());

    try {
        const response = await getApi(`project/projects/${projectId}`);
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

export function userCreateSuccess(team) {
    return {
        type: types.USER_CREATE_SUCCESS,
        payload: team,
    };
}

export function userCreateError(error) {
    return {
        type: types.USER_CREATE_FAILURE,
        payload: error,
    };
}

// Calls the API to add users to project.
export function userCreate(projectId, values) {
    return function(dispatch) {
        const promise = postApi(`team/${projectId}`, values);
        dispatch(userCreateRequest());
        promise.then(
            function(response) {
                const data = response.data;
                const projectUsers = data.filter(
                    team => team.projectId === projectId
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

export const fetchUserProjectsSuccess = users => {
    return {
        type: types.FETCH_USER_PROJECTS_SUCCESS,
        payload: users,
    };
};

export const fetchUserProjectsError = error => {
    return {
        type: types.FETCH_USER_PROJECTS_FAILURE,
        payload: error,
    };
};

// Calls the API to fetch users belonging to a particular project
export const fetchProjectTeam = projectId => async dispatch => {
    dispatch(fetchProjectTeamRequest());
    try {
        const response = await getApi(`team/${projectId}/teamMembers`);
        const team = response.data;
        const projectTeam = team.filter(team => team._id === projectId)[0];
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

export const fetchProjectTeamSuccess = payload => {
    return {
        type: types.FETCH_PROJECT_TEAM_SUCCESS,
        payload,
    };
};

export const fetchProjectTeamError = error => {
    return {
        type: types.FETCH_PROJECT_TEAM_ERROR,
        payload: error,
    };
};
export function userUpdateRoleRequest(id) {
    return {
        type: types.USER_UPDATE_ROLE_REQUEST,
        payload: id,
    };
}

export function userUpdateRoleSuccess(team) {
    return {
        type: types.USER_UPDATE_ROLE_SUCCESS,
        payload: team,
    };
}

export function userUpdateRoleError(error) {
    return {
        type: types.USER_UPDATE_ROLE_FAILURE,
        payload: error,
    };
}

export function changeUserProjectRole(team) {
    return {
        type: types.CHANGE_USER_PROJECT_ROLES,
        payload: team,
    };
}
// Calls the API to update user role.
export function userUpdateRole(projectId, values) {
    return function(dispatch) {
        const promise = putApi(
            `team/${projectId}/${values.teamMemberId}/changerole`,
            values
        );
        dispatch(userUpdateRoleRequest(values.teamMemberId));

        promise.then(
            function(response) {
                const data = response.data;
                const projectUsers = data.filter(
                    user => user.projectId === projectId
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

export function paginate(type) {
    return function(dispatch) {
        type === 'next' && dispatch(paginateNext());
        type === 'prev' && dispatch(paginatePrev());
    };
}

//Add Balance to a project
export const updateBalance = (
    projectId,
    rechargeBalanceAmount
) => async dispatch => {
    dispatch(updateProjectBalanceRequest());

    try {
        const response = await putApi(`project/${projectId}/updateBalance`, {
            rechargeBalanceAmount,
        });
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

export function updateProjectBalanceSuccess(project) {
    return {
        type: types.PROJECT_BALANCE_UPDATE_SUCCESS,
        payload: project,
    };
}

export function updateProjectBalanceError(error) {
    return {
        type: types.PROJECT_BALANCE_UPDATE_FAILURE,
        payload: error,
    };
}
// Calls the API to delete user from project
export function teamDelete(projectId, teamMemberId) {
    return function(dispatch) {
        const promise = deleteApi(`team/${projectId}/${teamMemberId}`, null);
        dispatch(teamDeleteRequest(teamMemberId));

        promise.then(
            function(response) {
                const team = response.data;
                const projectTeam = team.filter(
                    team => team.projectId === projectId
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

export function teamDeleteRequest(id) {
    return {
        type: types.TEAM_DELETE_REQUEST,
        payload: id,
    };
}
export function teamDeleteSuccess(team) {
    return {
        type: types.TEAM_DELETE_SUCCESS,
        payload: team,
    };
}

export function teamDeleteError(error) {
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
    return function(dispatch) {
        dispatch(teamDeleteReset());
    };
}

// Calls the API to fetch all user projects.
export const fetchUserProjects = (userId, skip, limit) => async dispatch => {
    skip = skip ? parseInt(skip) : 0;
    limit = limit ? parseInt(limit) : 10;

    dispatch(fetchUserProjectsRequest());

    try {
        const response = await getApi(
            `project/projects/user/${userId}?skip=${skip}&limit=${limit}`
        );
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

export const deleteProjectSuccess = project => {
    return {
        type: types.DELETE_PROJECT_SUCCESS,
        payload: project,
    };
};

export const deleteProjectError = error => {
    return {
        type: types.DELETE_PROJECT_FAILED,
        payload: error,
    };
};

// Calls the API to delete a project
export const deleteProject = projectId => async dispatch => {
    dispatch(deleteProjectRequest());

    try {
        const response = await deleteApi(`project/${projectId}/deleteProject`);
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

export const blockProjectSuccess = project => {
    return {
        type: types.BLOCK_PROJECT_SUCCESS,
        payload: project,
    };
};

export const blockProjectError = error => {
    return {
        type: types.BLOCK_PROJECT_FAILED,
        payload: error,
    };
};

// Calls the API to block a project
export const blockProject = projectId => async dispatch => {
    dispatch(blockProjectRequest());

    try {
        const response = await putApi(`project/${projectId}/blockProject`);
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

export const renewAlertLimitSuccess = project => {
    return {
        type: types.ALERT_LIMIT_SUCCESS,
        payload: project,
    };
};

export const renewAlertLimitError = error => {
    return {
        type: types.ALERT_LIMIT_FAILED,
        payload: error,
    };
};

// Calls the API to block a project
export const renewAlertLimit = (projectId, alertLimit) => async dispatch => {
    dispatch(renewAlertLimitRequest());

    try {
        const response = await putApi(`project/${projectId}/renewAlertLimit`, {
            alertLimit,
        });
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

export const restoreProjectSuccess = project => {
    return {
        type: types.RESTORE_PROJECT_SUCCESS,
        payload: project,
    };
};

export const restoreProjectError = error => {
    return {
        type: types.RESTORE_PROJECT_FAILED,
        payload: error,
    };
};

// Calls the API to restore a project
export const restoreProject = projectId => async dispatch => {
    dispatch(restoreProjectRequest());

    try {
        const response = await putApi(`project/${projectId}/restoreProject`);
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

export const unblockProjectSuccess = project => {
    return {
        type: types.UNBLOCK_PROJECT_SUCCESS,
        payload: project,
    };
};

export const unblockProjectError = error => {
    return {
        type: types.UNBLOCK_PROJECT_FAILED,
        payload: error,
    };
};

// Calls the API to un-block a project
export const unblockProject = projectId => async dispatch => {
    dispatch(unblockProjectRequest());

    try {
        const response = await putApi(`project/${projectId}/unblockProject`);
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

export const addProjectNoteSuccess = projectNote => {
    return {
        type: types.ADD_PROJECT_NOTE_SUCCESS,
        payload: projectNote,
    };
};

export const addProjectNoteError = error => {
    return {
        type: types.ADD_PROJECT_NOTE_FAILURE,
        payload: error,
    };
};

// Calls the API to add Admin Note
export const addProjectNote = (projectId, values) => async dispatch => {
    dispatch(addProjectNoteRequest());

    try {
        const response = await postApi(`project/${projectId}/addNote`, values);
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

export const searchProjectsSuccess = projects => {
    return {
        type: types.SEARCH_PROJECTS_SUCCESS,
        payload: projects,
    };
};

export const searchProjectsError = error => {
    return {
        type: types.SEARCH_PROJECTS_FAILURE,
        payload: error,
    };
};

// Calls the search projects api
export const searchProjects = (filter, skip, limit) => async dispatch => {
    const values = {
        filter,
    };

    dispatch(searchProjectsRequest());

    try {
        const response = await postApi(
            `project/projects/search?skip=${skip}&limit=${limit}`,
            values
        );
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

export const changePlanSuccess = payload => {
    return {
        type: types.CHANGE_PLAN_SUCCESS,
        payload,
    };
};

export const changePlanFailure = error => {
    return {
        type: types.CHANGE_PLAN_FAILURE,
        payload: error,
    };
};

export const changePlan = (
    projectId,
    planId,
    projectName,
    oldPlan,
    newPlan
) => async dispatch => {
    dispatch(changePlanRequest());

    try {
        const response = await putApi(`project/${projectId}/admin/changePlan`, {
            projectName,
            planId,
            oldPlan,
            newPlan,
        });
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

export function fetchProjectDomainsSuccess(payload) {
    return {
        type: types.PROJECT_DOMAIN_SUCCESS,
        payload,
    };
}

export function fetchProjectDomainsFailure(error) {
    return {
        type: types.PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
}

export function fetchProjectDomains(projectId, skip = 0, limit = 10) {
    return async function(dispatch) {
        dispatch(fetchProjectDomainsRequest());

        try {
            const response = await getApi(
                `domainVerificationToken/${projectId}/domains?skip=${skip}&limit=${limit}`
            );
            dispatch(fetchProjectDomainsSuccess(response.data));
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

export function deleteProjectDomainSuccess(payload) {
    return {
        type: types.DELETE_PROJECT_DOMAIN_SUCCESS,
        payload,
    };
}

export function deleteProjectDomainFailure(error) {
    return {
        type: types.DELETE_PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
}

export function deleteProjectDomain({ projectId, domainId }) {
    return async function(dispatch) {
        dispatch(deleteProjectDomainRequest());

        try {
            const response = await deleteApi(
                `domainVerificationToken/${projectId}/domain/${domainId}`
            );
            dispatch(deleteProjectDomainSuccess(response.data));
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
            dispatch(deleteProjectDomainFailure(errorMessage));
        }
    };
}

export function verifyProjectDomainRequest() {
    return {
        type: types.VERIFY_PROJECT_DOMAIN_REQUEST,
    };
}

export function verifyProjectDomainSuccess(payload) {
    return {
        type: types.VERIFY_PROJECT_DOMAIN_SUCCESS,
        payload,
    };
}

export function verifyProjectDomainFailure(error) {
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

export function verifyProjectDomain({ projectId, domainId, data }) {
    return async function(dispatch) {
        dispatch(verifyProjectDomainRequest());

        try {
            const response = await putApi(
                `domainVerificationToken/${projectId}/verify/${domainId}`,
                data
            );
            dispatch(verifyProjectDomainSuccess(response.data));
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
