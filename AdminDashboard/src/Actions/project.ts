import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/project';
import PositiveNumber from 'Common/Types/PositiveNumber';
// Fetch Projects

export const fetchProjectsRequest: Function = (): void => {
    return {
        type: types.FETCH_PROJECTS_REQUEST,
    };
};

export const fetchProjectsSuccess: Function = (projects: $TSFixMe): void => {
    return {
        type: types.FETCH_PROJECTS_SUCCESS,
        payload: projects,
    };
};

export const fetchProjectsError: Function = (error: $TSFixMe): void => {
    return {
        type: types.FETCH_PROJECTS_FAILURE,
        payload: error,
    };
};

// Calls the API to fetch all projects.
export const fetchProjects =
    (skip: PositiveNumber, limit: PositiveNumber) =>
    async (dispatch: Dispatch) => {
        skip = skip || 0;
        limit = limit || 10;

        dispatch(fetchProjectsRequest());

        try {
            const response = await BackendAPI.get(
                `project/projects/allProjects?skip=${skip}&limit=${limit}`
            );

            dispatch(fetchProjectsSuccess(response.data));
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
            dispatch(fetchProjectsError(errorMsg));
        }
    };

export const fetchProjectRequest: Function = (): void => {
    return {
        type: types.FETCH_PROJECT_REQUEST,
    };
};

export const fetchProjectSuccess: Function = (project: $TSFixMe): void => {
    return {
        type: types.FETCH_PROJECT_SUCCESS,
        payload: project,
    };
};

export const fetchProjectError: Function = (error: $TSFixMe): void => {
    return {
        type: types.FETCH_PROJECT_FAILURE,
        payload: error,
    };
};

// Calls the API to fetch a project.
export const fetchProject =
    (slug: $TSFixMe) =>
    async (dispatch: Dispatch): void => {
        dispatch(fetchProjectRequest());

        try {
            const response = await BackendAPI.get(`project/projects/${slug}`);

            const projects = response.data;

            dispatch(fetchProjectSuccess(projects));
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
            dispatch(fetchProjectError(errorMsg));
        }
    };

// Team create
export const userCreateRequest: Function = (): void => {
    return {
        type: types.USER_CREATE_REQUEST,
    };
};

export const userCreateSuccess: Function = (team: $TSFixMe): void => {
    return {
        type: types.USER_CREATE_SUCCESS,
        payload: team,
    };
};

export const userCreateError: Function = (error: $TSFixMe): void => {
    return {
        type: types.USER_CREATE_FAILURE,
        payload: error,
    };
};

// Calls the API to add users to project.
export const userCreate: Function = (
    projectId: ObjectID,
    values: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(`team/${projectId}`, values);
        dispatch(userCreateRequest());
        promise.then(
            (response): void => {
                const data = response.data;
                const projectUsers = data.filter(
                    (team: $TSFixMe) => team.projectId === projectId
                )[0];
                dispatch(userCreateSuccess(projectUsers.team));
            },
            (error): void => {
                dispatch(userCreateError(error));
            }
        );

        return promise;
    };
};

export const fetchUserProjectsRequest: Function = (): void => {
    return {
        type: types.FETCH_USER_PROJECTS_REQUEST,
    };
};

export const fetchUserProjectsSuccess: Function = (users: $TSFixMe): void => {
    return {
        type: types.FETCH_USER_PROJECTS_SUCCESS,
        payload: users,
    };
};

export const fetchUserProjectsError: Function = (error: $TSFixMe): void => {
    return {
        type: types.FETCH_USER_PROJECTS_FAILURE,
        payload: error,
    };
};

// Calls the API to fetch users belonging to a particular project
export const fetchProjectTeam =
    (projectId: ObjectID) => async (dispatch: Dispatch) => {
        dispatch(fetchProjectTeamRequest());
        try {
            const response = await BackendAPI.get(
                `team/${projectId}/teamMembers`
            );

            const team = response.data;
            const projectTeam = team.filter(
                (team: $TSFixMe) => team._id === projectId
            )[0];
            dispatch(fetchProjectTeamSuccess(projectTeam));
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
            dispatch(fetchProjectTeamError(errorMsg));
        }
    };

export const fetchProjectTeamRequest: Function = (): void => {
    return {
        type: types.FETCH_PROJECT_TEAM_REQUEST,
    };
};

export const fetchProjectTeamSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_PROJECT_TEAM_SUCCESS,
        payload,
    };
};

export const fetchProjectTeamError: Function = (error: $TSFixMe): void => {
    return {
        type: types.FETCH_PROJECT_TEAM_ERROR,
        payload: error,
    };
};
export const userUpdateRoleRequest: Function = (id: $TSFixMe): void => {
    return {
        type: types.USER_UPDATE_ROLE_REQUEST,
        payload: id,
    };
};

export const userUpdateRoleSuccess: Function = (team: $TSFixMe): void => {
    return {
        type: types.USER_UPDATE_ROLE_SUCCESS,
        payload: team,
    };
};

export const userUpdateRoleError: Function = (error: $TSFixMe): void => {
    return {
        type: types.USER_UPDATE_ROLE_FAILURE,
        payload: error,
    };
};

export const changeUserProjectRole: Function = (team: $TSFixMe): void => {
    return {
        type: types.CHANGE_USER_PROJECT_ROLES,
        payload: team,
    };
};
// Calls the API to update user role.
export const userUpdateRole: Function = (
    projectId: ObjectID,
    values: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put(
            `team/${projectId}/${values.teamMemberId}/changerole`,
            values
        );
        dispatch(userUpdateRoleRequest(values.teamMemberId));

        promise.then(
            (response): void => {
                const data = response.data;
                const projectUsers = data.filter(
                    (user: $TSFixMe) => user.projectId === projectId
                )[0];
                dispatch(userUpdateRoleSuccess(projectUsers));
            },
            (error): void => {
                dispatch(userUpdateRoleError(error));
            }
        );

        return promise;
    };
};

//userlist pagination
export const paginateNext: Function = (): void => {
    return {
        type: types.PAGINATE_USERS_NEXT,
    };
};

export const paginatePrev: Function = (): void => {
    return {
        type: types.PAGINATE_USERS_PREV,
    };
};

export const paginate: Function = (type: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        type === 'next' && dispatch(paginateNext());
        type === 'prev' && dispatch(paginatePrev());
    };
};

//Add Balance to a project
export const updateBalance =
    (projectId: ObjectID, rechargeBalanceAmount: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        dispatch(updateProjectBalanceRequest());

        try {
            const response = await BackendAPI.put(
                `project/${projectId}/updateBalance`,
                {
                    rechargeBalanceAmount,
                }
            );

            const data = response.data;
            dispatch(updateProjectBalanceSuccess(data));
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
            dispatch(updateProjectBalanceError(errorMsg));
        }
    };

export const updateProjectBalanceRequest: Function = (): void => {
    return {
        type: types.PROJECT_BALANCE_UPDATE_REQUEST,
    };
};

export const updateProjectBalanceSuccess: Function = (
    project: $TSFixMe
): void => {
    return {
        type: types.PROJECT_BALANCE_UPDATE_SUCCESS,
        payload: project,
    };
};

export const updateProjectBalanceError: Function = (error: $TSFixMe): void => {
    return {
        type: types.PROJECT_BALANCE_UPDATE_FAILURE,
        payload: error,
    };
};
// Calls the API to delete user from project
export const teamDelete: Function = (
    projectId: ObjectID,
    teamMemberId: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = delete (`team/${projectId}/${teamMemberId}`, null);
        dispatch(teamDeleteRequest(teamMemberId));

        promise.then(
            (response): void => {
                const team = response.data;
                const projectTeam = team.filter(
                    (team: $TSFixMe) => team.projectId === projectId
                )[0];
                dispatch(teamDeleteSuccess(projectTeam.team));
                return { team };
            },
            (error): void => {
                dispatch(teamDeleteError(error));
                return { error };
            }
        );

        return promise;
    };
};

export const teamDeleteRequest: Function = (id: $TSFixMe): void => {
    return {
        type: types.TEAM_DELETE_REQUEST,
        payload: id,
    };
};
export const teamDeleteSuccess: Function = (team: $TSFixMe): void => {
    return {
        type: types.TEAM_DELETE_SUCCESS,
        payload: team,
    };
};

export const teamDeleteError: Function = (error: $TSFixMe): void => {
    return {
        type: types.TEAM_DELETE_FAILURE,
        payload: error,
    };
};

export const teamDeleteReset: Function = (): void => {
    return {
        type: types.TEAM_DELETE_RESET,
    };
};
export const resetTeamDelete: Function = (): void => {
    return function (dispatch: Dispatch): void {
        dispatch(teamDeleteReset());
    };
};

// Calls the API to fetch all user projects.
export const fetchUserProjects =
    (userId: ObjectID, skip: PositiveNumber, limit: PositiveNumber) =>
    async (dispatch: Dispatch) => {
        skip = skip ? parseInt(skip) : 0;
        limit = limit ? parseInt(limit) : 10;

        dispatch(fetchUserProjectsRequest());

        try {
            const response = await BackendAPI.get(
                `project/projects/user/${userId}?skip=${skip}&limit=${limit}`
            );

            const users = response.data;

            dispatch(fetchUserProjectsSuccess(users));
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
            dispatch(fetchUserProjectsError(errorMsg));
        }
    };

//Delete project
export const deleteProjectRequest: Function = (): void => {
    return {
        type: types.DELETE_PROJECT_REQUEST,
    };
};

export const deleteProjectReset: Function = (): void => {
    return {
        type: types.DELETE_PROJECT_RESET,
    };
};

export const deleteProjectSuccess: Function = (project: $TSFixMe): void => {
    return {
        type: types.DELETE_PROJECT_SUCCESS,
        payload: project,
    };
};

export const deleteProjectError: Function = (error: $TSFixMe): void => {
    return {
        type: types.DELETE_PROJECT_FAILED,
        payload: error,
    };
};

// Calls the API to delete a project
export const deleteProject =
    (projectId: ObjectID) => async (dispatch: Dispatch) => {
        dispatch(deleteProjectRequest());

        try {
            const response = await delete `project/${projectId}/deleteProject`;

            const data = response.data;

            dispatch(deleteProjectSuccess(data));
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
            dispatch(deleteProjectError(errorMsg));
        }
    };

//Block project
export const blockProjectRequest: Function = (): void => {
    return {
        type: types.BLOCK_PROJECT_REQUEST,
    };
};

export const blockProjectReset: Function = (): void => {
    return {
        type: types.BLOCK_PROJECT_RESET,
    };
};

export const blockProjectSuccess: Function = (project: $TSFixMe): void => {
    return {
        type: types.BLOCK_PROJECT_SUCCESS,
        payload: project,
    };
};

export const blockProjectError: Function = (error: $TSFixMe): void => {
    return {
        type: types.BLOCK_PROJECT_FAILED,
        payload: error,
    };
};

// Calls the API to block a project
export const blockProject =
    (projectId: ObjectID) => async (dispatch: Dispatch) => {
        dispatch(blockProjectRequest());

        try {
            const response = await BackendAPI.put(
                `project/${projectId}/blockProject`
            );

            const data = response.data;

            dispatch(blockProjectSuccess(data));
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
            dispatch(blockProjectError(errorMsg));
        }
    };

//Renew Alert Limit
export const renewAlertLimitRequest: Function = (): void => {
    return {
        type: types.ALERT_LIMIT_REQUEST,
    };
};

export const renewAlertLimitReset: Function = (): void => {
    return {
        type: types.ALERT_LIMIT_RESET,
    };
};

export const renewAlertLimitSuccess: Function = (project: $TSFixMe): void => {
    return {
        type: types.ALERT_LIMIT_SUCCESS,
        payload: project,
    };
};

export const renewAlertLimitError: Function = (error: $TSFixMe): void => {
    return {
        type: types.ALERT_LIMIT_FAILED,
        payload: error,
    };
};

// Calls the API to block a project
export const renewAlertLimit =
    (projectId: ObjectID, alertLimit: PositiveNumber) =>
    async (dispatch: Dispatch) => {
        dispatch(renewAlertLimitRequest());

        try {
            const response = await BackendAPI.put(
                `project/${projectId}/renewAlertLimit`,
                {
                    alertLimit,
                }
            );

            const data = response.data;

            dispatch(renewAlertLimitSuccess(data));
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
            dispatch(renewAlertLimitError(errorMsg));
        }
    };

//Restore project
export const restoreProjectRequest: Function = (): void => {
    return {
        type: types.RESTORE_PROJECT_REQUEST,
    };
};

export const restoreProjectReset: Function = (): void => {
    return {
        type: types.RESTORE_PROJECT_RESET,
    };
};

export const restoreProjectSuccess: Function = (project: $TSFixMe): void => {
    return {
        type: types.RESTORE_PROJECT_SUCCESS,
        payload: project,
    };
};

export const restoreProjectError: Function = (error: $TSFixMe): void => {
    return {
        type: types.RESTORE_PROJECT_FAILED,
        payload: error,
    };
};

// Calls the API to restore a project
export const restoreProject =
    (projectId: ObjectID) => async (dispatch: Dispatch) => {
        dispatch(restoreProjectRequest());

        try {
            const response = await BackendAPI.put(
                `project/${projectId}/restoreProject`
            );

            const data = response.data;

            dispatch(restoreProjectSuccess(data));
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
            dispatch(restoreProjectError(errorMsg));
        }
    };

//Unblock project
export const unblockProjectRequest: Function = (): void => {
    return {
        type: types.UNBLOCK_PROJECT_REQUEST,
    };
};

export const unblockProjectReset: Function = (): void => {
    return {
        type: types.UNBLOCK_PROJECT_RESET,
    };
};

export const unblockProjectSuccess: Function = (project: $TSFixMe): void => {
    return {
        type: types.UNBLOCK_PROJECT_SUCCESS,
        payload: project,
    };
};

export const unblockProjectError: Function = (error: $TSFixMe): void => {
    return {
        type: types.UNBLOCK_PROJECT_FAILED,
        payload: error,
    };
};

// Calls the API to un-block a project
export const unblockProject =
    (projectId: ObjectID) => async (dispatch: Dispatch) => {
        dispatch(unblockProjectRequest());

        try {
            const response = await BackendAPI.put(
                `project/${projectId}/unblockProject`
            );

            const data = response.data;

            dispatch(unblockProjectSuccess(data));
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
            dispatch(unblockProjectError(errorMsg));
        }
    };

//Add Project Notes
export const addProjectNoteRequest: Function = (): void => {
    return {
        type: types.ADD_PROJECT_NOTE_REQUEST,
    };
};

export const addProjectNoteReset: Function = (): void => {
    return {
        type: types.ADD_PROJECT_NOTE_RESET,
    };
};

export const addProjectNoteSuccess: Function = (
    projectNote: $TSFixMe
): void => {
    return {
        type: types.ADD_PROJECT_NOTE_SUCCESS,
        payload: projectNote,
    };
};

export const addProjectNoteError: Function = (error: $TSFixMe): void => {
    return {
        type: types.ADD_PROJECT_NOTE_FAILURE,
        payload: error,
    };
};

// Calls the API to add Admin Note
export const addProjectNote =
    (projectId: ObjectID, values: $TSFixMe) => async (dispatch: Dispatch) => {
        dispatch(addProjectNoteRequest());

        try {
            const response = await BackendAPI.post(
                `project/${projectId}/addNote`,
                values
            );

            const data = response.data;

            dispatch(addProjectNoteSuccess(data));
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
            dispatch(addProjectNoteError(errorMsg));
        }
    };

//Search Projects
export const searchProjectsRequest: Function = (): void => {
    return {
        type: types.SEARCH_PROJECTS_REQUEST,
    };
};

export const searchProjectsReset: Function = (): void => {
    return {
        type: types.SEARCH_PROJECTS_RESET,
    };
};

export const searchProjectsSuccess: Function = (projects: $TSFixMe): void => {
    return {
        type: types.SEARCH_PROJECTS_SUCCESS,
        payload: projects,
    };
};

export const searchProjectsError: Function = (error: $TSFixMe): void => {
    return {
        type: types.SEARCH_PROJECTS_FAILURE,
        payload: error,
    };
};

// Calls the search projects api
export const searchProjects =
    (filter: $TSFixMe, skip: PositiveNumber, limit: PositiveNumber) =>
    async (dispatch: Dispatch) => {
        const values = {
            filter,
        };

        dispatch(searchProjectsRequest());

        try {
            const response = await BackendAPI.post(
                `project/projects/search?skip=${skip}&limit=${limit}`,
                values
            );

            const data = response.data;

            dispatch(searchProjectsSuccess(data));
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
            dispatch(searchProjectsError(errorMsg));
        }
    };

// Upgrade a Project
export const changePlanRequest: Function = (): void => {
    return {
        type: types.CHANGE_PLAN_REQUEST,
    };
};

export const changePlanSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.CHANGE_PLAN_SUCCESS,
        payload,
    };
};

export const changePlanFailure: Function = (error: $TSFixMe): void => {
    return {
        type: types.CHANGE_PLAN_FAILURE,
        payload: error,
    };
};

export const changePlan =
    (
        projectId: ObjectID,
        planId: $TSFixMe,
        projectName: $TSFixMe,
        oldPlan: $TSFixMe,
        newPlan: $TSFixMe
    ) =>
    async (dispatch: Dispatch) => {
        dispatch(changePlanRequest());

        try {
            const response = await BackendAPI.put(
                `project/${projectId}/admin/changePlan`,
                {
                    projectName,
                    planId,
                    oldPlan,
                    newPlan,
                }
            );

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

export const fetchProjectDomainsRequest: Function = (): void => {
    return {
        type: types.PROJECT_DOMAIN_REQUEST,
    };
};

export const fetchProjectDomainsSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.PROJECT_DOMAIN_SUCCESS,
        payload,
    };
};

export const fetchProjectDomainsFailure: Function = (error: $TSFixMe): void => {
    return {
        type: types.PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
};

export const fetchProjectDomains: Function = (
    projectId: ObjectID,
    skip = 0,
    limit = 10
): void => {
    return async function (dispatch: Dispatch): void {
        dispatch(fetchProjectDomainsRequest());

        try {
            const response = await BackendAPI.get(
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
};

export const deleteProjectDomainRequest: Function = (): void => {
    return {
        type: types.DELETE_PROJECT_DOMAIN_REQUEST,
    };
};

export const deleteProjectDomainSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.DELETE_PROJECT_DOMAIN_SUCCESS,
        payload,
    };
};

export const deleteProjectDomainFailure: Function = (error: $TSFixMe): void => {
    return {
        type: types.DELETE_PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
};

export const resetDeleteProjectDomain: Function = (): void => {
    return {
        type: types.RESET_DELETE_PROJECT_DOMAIN,
    };
};

export const deleteProjectDomain: Function = ({
    projectId,
    domainId,
}: $TSFixMe): void => {
    return async function (dispatch: Dispatch): void {
        dispatch(deleteProjectDomainRequest());

        const promise =
            delete `domainVerificationToken/${projectId}/domain/${domainId}`;
        promise.then(
            (response): void => {
                dispatch(deleteProjectDomainSuccess(response.data));

                return response.data;
            },
            (error): void => {
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
};

export const verifyProjectDomainRequest: Function = (): void => {
    return {
        type: types.VERIFY_PROJECT_DOMAIN_REQUEST,
    };
};

export const verifyProjectDomainSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.VERIFY_PROJECT_DOMAIN_SUCCESS,
        payload,
    };
};

export const verifyProjectDomainFailure: Function = (error: $TSFixMe): void => {
    return {
        type: types.VERIFY_PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
};

export const resetVerifyProjectDomain: Function = (): void => {
    return {
        type: types.RESET_VERIFY_PROJECT_DOMAIN,
    };
};

export const verifyProjectDomain: Function = ({
    projectId,
    domainId,
}: $TSFixMe): void => {
    return async function (dispatch: Dispatch): void {
        dispatch(verifyProjectDomainRequest());

        try {
            const response = await BackendAPI.put(
                `domainVerificationToken/${projectId}/forceVerify/${domainId}`
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
};

export const unVerifyProjectDomainRequest: Function = (): void => {
    return {
        type: types.UNVERIFY_PROJECT_DOMAIN_REQUEST,
    };
};

export const unVerifyProjectDomainSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.UNVERIFY_PROJECT_DOMAIN_SUCCESS,
        payload,
    };
};

export const unVerifyProjectDomainFailure: Function = (
    error: $TSFixMe
): void => {
    return {
        type: types.UNVERIFY_PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
};

export const resetUnverifyProjectDomain: Function = (): void => {
    return {
        type: types.RESET_UNVERIFY_PROJECT_DOMAIN,
    };
};

export const unVerifyProjectDomain: Function = (
    projectId: ObjectID,
    domainId: $TSFixMe
): void => {
    return async function (dispatch: Dispatch): void {
        dispatch(unVerifyProjectDomainRequest());

        const promise = BackendAPI.put(
            `domainVerificationToken/${projectId}/unverify/${domainId}`
        );
        promise.then(
            (response): void => {
                dispatch(unVerifyProjectDomainSuccess(response.data));
            },
            (error): void => {
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
};

export const resetProjectDomainRequest: Function = (): void => {
    return {
        type: types.RESET_PROJECT_DOMAIN_REQUEST,
    };
};

export const resetProjectDomainSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.RESET_PROJECT_DOMAIN_SUCCESS,
        payload,
    };
};

export const resetProjectDomainFailure: Function = (error: $TSFixMe): void => {
    return {
        type: types.RESET_PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
};

export const resetProjectDomainOnMount: Function = (): void => {
    return {
        type: types.RESET_PROJECT_DOMAIN_ON_MOUNT,
    };
};

export const resetProjectDomain: Function = (
    projectId: ObjectID,
    domainId: $TSFixMe
): void => {
    return async function (dispatch: Dispatch): void {
        dispatch(resetProjectDomainRequest());

        const promise = BackendAPI.put(
            `domainVerificationToken/${projectId}/resetDomain/${domainId}`
        );
        promise.then(
            (response): void => {
                dispatch(resetProjectDomainSuccess(response.data));
            },
            (error): void => {
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
};
