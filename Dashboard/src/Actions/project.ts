import BackendAPI from 'CommonUI/src/utils/api/backend';
import Route from 'Common/Types/api/route';
import { Dispatch } from 'redux';
import * as types from '../constants/project';
import { User, IS_SAAS_SERVICE } from '../config.js';
import { history } from '../store';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import { fetchComponents } from './component';
import {
    fetchMonitors,
    resetFetchMonitors,
    resetCreateMonitor,
    deleteProjectMonitors,
} from './monitor';
import { fetchTutorial, resetFetchTutorial } from './tutorial';
import {
    fetchResourceCategories,
    fetchResourceCategoriesForNewResource,
} from './resourceCategories';
import {
    fetchSubProjectSchedules,
    resetSubProjectSchedule,
    fetchSchedules,
    resetSchedule,
    deleteProjectSchedules,
} from './schedule';
import {
    fetchSubProjectStatusPages,
    resetSubProjectFetchStatusPages,
    deleteProjectStatusPages,
} from './statusPage';
import { fetchUnresolvedIncidents, resetUnresolvedIncidents } from './incident';
import { fetchNotifications, fetchNotificationsReset } from './notification';
import { fetchAlert, resetAlert } from './alert';
import { deleteProjectIncidents } from './incident';
import {
    getSubProjects,
    resetSubProjects,
    setActiveSubProject,
} from './subProject';
import { resetFetchComponentResources } from './component';

import isMainProjectViewer from '../Utils/isMainProjectViewer';
import { socket } from '../components/basic/Socket';

export const changeDeleteModal = (): void => {
    return {
        type: types.CHANGE_DELETE_MODAL,
    };
};

export const showDeleteModal = (): void => {
    return {
        type: types.SHOW_DELETE_MODAL,
    };
};

export const hideDeleteModal = (): void => {
    return {
        type: types.HIDE_DELETE_MODAL,
    };
};

export const hideDeleteModalSaasMode = (): void => {
    return {
        type: types.HIDE_DELETE_MODAL_SAAS_MODE,
    };
};

export const showForm = (): void => {
    return {
        type: types.SHOW_PROJECT_FORM,
    };
};

export const hideForm = (): void => {
    return {
        type: types.HIDE_PROJECT_FORM,
    };
};

export const showUpgradeForm = (): void => {
    return {
        type: types.SHOW_UPGRADE_FORM,
    };
};

export const hideUpgradeForm = (): void => {
    return {
        type: types.HIDE_UPGRADE_FORM,
    };
};

// Sets the whether the user can upgrade(canUpgrade) their plan
// if their returned plan list is empty or not.
export const upgradePlanEmpty = (): void => {
    return {
        type: types.UPGRADE_PLAN_EMPTY,
    };
};

export const projectsRequest = (promise: $TSFixMe): void => {
    return {
        type: types.PROJECTS_REQUEST,
        payload: promise,
    };
};

export const projectsError = (error: ErrorPayload): void => {
    return {
        type: types.PROJECTS_FAILED,
        payload: error,
    };
};

export const projectsSuccess = (projects: $TSFixMe): void => {
    return {
        type: types.PROJECTS_SUCCESS,
        payload: projects,
    };
};

export const resetProjects = (): void => {
    return {
        type: types.PROJECTS_RESET,
    };
};

export const getProjects = (switchToProjectId: string): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `project/projects?skip=${0}&limit=${9999}`,

            null
        );
        dispatch(projectsRequest(promise));

        promise.then(
            function (projects): void {
                projects = projects.data && projects.data.data;
                dispatch(projectsSuccess(projects));

                if (projects.length > 0 && !switchToProjectId) {
                    if (User.getCurrentProjectId()) {
                        const project = projects.filter(
                            (project: $TSFixMe) =>
                                project._id === User.getCurrentProjectId()
                        );
                        if (project && project.length > 0) {
                            dispatch(switchProject(dispatch, project[0]));
                        } else {
                            dispatch(switchProject(dispatch, projects[0]));
                        }
                    } else {
                        dispatch(switchProject(dispatch, projects[0]));
                    }
                } else {
                    let projectSwitched = false;

                    for (let i = 0; i < projects.length; i++) {
                        if (projects[i]._id === switchToProjectId) {
                            dispatch(switchProject(dispatch, projects[i]));
                            projectSwitched = true;
                        }
                    }
                    if (User.getCurrentProjectId() && !projectSwitched) {
                        const project = projects.filter(
                            (project: $TSFixMe) =>
                                project._id === User.getCurrentProjectId()
                        );
                        if (project.length > 0) {
                            dispatch(switchProject(dispatch, project[0]));
                            projectSwitched = true;
                        }
                    }
                    !projectSwitched &&
                        dispatch(switchProject(dispatch, projects[0]));
                }
            },
            function (error): void {
                dispatch(projectsError(error));
            }
        );

        return promise;
    };
};

export const getProjectBalanceRequest = (): void => {
    return {
        type: types.GET_PROJECT_BALANCE_REQUEST,
    };
};
export const getprojectError = (error: ErrorPayload): void => {
    return {
        type: types.GET_PROJECT_BALANCE_FAILED,
        payload: error,
    };
};
export const getProjectBalanceSuccess = (project: $TSFixMe): void => {
    return {
        type: types.GET_PROJECT_BALANCE_SUCCESS,
        payload: project,
    };
};

export const getProjectBalance = (projectId: string): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(`project/${projectId}/balance`, null);

        dispatch(getProjectBalanceRequest(promise));

        promise.then(
            function (balance): void {
                dispatch(getProjectBalanceSuccess(balance.data));
            },
            function (error): void {
                dispatch(getprojectError(error));
            }
        );
    };
};
export const createProjectRequest = (): void => {
    return {
        type: types.CREATE_PROJECT_REQUEST,
    };
};

export const createProjectError = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_PROJECT_FAILED,
        payload: error,
    };
};

export const createProjectSuccess = (project: $TSFixMe): void => {
    return {
        type: types.CREATE_PROJECT_SUCCESS,
        payload: project,
    };
};

export const resetCreateProject = (): void => {
    return {
        type: types.CREATE_PROJECT_RESET,
    };
};

export const createProject = (values: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(new Route('project/create'), values);

        dispatch(createProjectRequest());

        return promise.then(
            function (project): void {
                if (IS_SAAS_SERVICE) {
                    User.setCardRegistered(true);
                }

                dispatch(createProjectSuccess(project.data));

                return project.data;
            },
            function (error): void {
                dispatch(createProjectError(error));
            }
        );
    };
};

export function switchToProjectViewerNav(
    userId: string,
    subProjects: $TSFixMe,
    currentProject: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: types.SHOW_VIEWER_MENU,
            payload: isMainProjectViewer(userId, subProjects, currentProject),
        });
    };
}

export function switchProject(
    dispatch: Dispatch,
    project: $TSFixMe,
    subProjects = []
): void {
    const currentProjectId = User.getCurrentProjectId();
    const historyProjectId = history.location.pathname.split('project')[1];

    //get project slug from pathname
    const pathname = history.location.pathname;
    const regex = new RegExp('/dashboard/project/([A-z-0-9]+)/?.+', 'i');
    const match = pathname.match(regex);

    let projectSlug;
    if (match) {
        projectSlug = match[1];
    }

    const loggedInUser = User.getUserId();
    const switchToMainProject = project?.users.find(
        (user: $TSFixMe) => (user.userId._id || user.userId) === loggedInUser
    );

    // if the path is already pointing to project slug we do not need to switch projects
    // esp. if this is from a redirectTo
    if (project.slug === projectSlug) {
        // ensure we update current project in localStorage
        User.setCurrentProjectId(project._id);

        // remove accessToken from url from redirects
        const search = history.location.search;
        if (search) {
            const searchParams = new URLSearchParams(search);
            searchParams.delete('accessToken');
            history.push({
                pathname: history.location.pathname,
                search: searchParams.toString(),
            });
        }
    } else if (!currentProjectId || project._id !== currentProjectId) {
        const isViewer = isMainProjectViewer(
            User.getUserId(),
            subProjects,
            project
        );
        if (isViewer) {
            history.push(`/dashboard/project/${project.slug}/StatusPages`);
        } else {
            history.push(`/dashboard/project/${project.slug}`);
        }
        User.setCurrentProjectId(project._id);

        switchToMainProject && dispatch(setActiveSubProject(project._id, true));
    } else if (historyProjectId && historyProjectId === '/') {
        history.push(`/dashboard/project/${project.slug}`);
    }

    if (
        !User.getActivesubProjectId('active_subproject_id') &&
        switchToMainProject
    ) {
        dispatch(setActiveSubProject(project._id, true));
    }

    const activesubProjectId = User.getActivesubProjectId(
        'active_subproject_id'
    );

    // emit project id to connect to room in backend
    socket?.emit('project_switch', activesubProjectId);

    dispatch(resetSubProjects());
    dispatch(resetAlert());
    dispatch(resetSchedule());
    dispatch(resetSubProjectSchedule());
    dispatch(resetFetchMonitors());
    dispatch(resetUnresolvedIncidents());
    dispatch(resetCreateMonitor());
    dispatch(resetSubProjectFetchStatusPages());
    dispatch(fetchNotificationsReset());
    dispatch(resetFetchTutorial());
    dispatch(resetFetchComponentResources());
    dispatch(setActiveSubProject(activesubProjectId));

    if (!currentProjectId || project._id !== currentProjectId) {
        getSubProjects(project._id)(dispatch).then(res => {
            if (!switchToMainProject) {
                const { data } = res.data;
                const projectId = data[0]._id;
                if (data.length > 0) {
                    dispatch(setActiveSubProject(projectId));
                }
            }
        });
    } else {
        getSubProjects(project._id)(dispatch);
    }
    fetchAlert(activesubProjectId)(dispatch);

    fetchSubProjectStatusPages(activesubProjectId)(dispatch);
    fetchComponents({ projectId: activesubProjectId })(dispatch); // default skip = 0, limit = 3
    fetchMonitors(activesubProjectId)(dispatch);

    fetchResourceCategories(project._id)(dispatch);
    fetchResourceCategoriesForNewResource(project._id)(dispatch);
    fetchUnresolvedIncidents(project._id, true)(dispatch);

    fetchSchedules(activesubProjectId)(dispatch);
    fetchSubProjectSchedules(activesubProjectId)(dispatch);
    fetchNotifications(project._id)(dispatch);
    fetchTutorial()(dispatch);
    User.setProject(JSON.stringify(project));

    return {
        type: types.SWITCH_PROJECT,
        payload: project,
    };
}

export const switchProjectReset = (): void => {
    return {
        type: types.SWITCH_PROJECT_RESET,
    };
};

export const showProjectSwitcher = (): void => {
    return {
        type: types.SHOW_PROJECT_SWITCHER,
    };
};

export const hideProjectSwitcher = (): void => {
    return {
        type: types.HIDE_PROJECT_SWITCHER,
    };
};

export const resetProjectTokenReset = (): void => {
    return {
        type: types.RESET_PROJECT_TOKEN_RESET,
    };
};

export const resetProjectTokenRequest = (): void => {
    return {
        type: types.RESET_PROJECT_TOKEN_REQUEST,
    };
};

export const resetProjectTokenSuccess = (project: $TSFixMe): void => {
    return {
        type: types.RESET_PROJECT_TOKEN_SUCCESS,
        payload: project.data,
    };
};

export const resetProjectTokenError = (error: ErrorPayload): void => {
    return {
        type: types.RESET_PROJECT_TOKEN_FAILED,
        payload: error,
    };
};

export const resetProjectToken = (projectId: string): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(`project/${projectId}/resetToken`);

        dispatch(resetProjectTokenRequest());

        promise
            .then(
                function (project): void {
                    dispatch(resetProjectTokenSuccess(project));
                },
                function (error): void {
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
                    dispatch(resetProjectTokenError(error));
                }
            )
            .then(function (): void {
                dispatch(resetProjectTokenReset());
            });

        return promise;
    };
};

export const renameProjectReset = (): void => {
    return {
        type: types.RENAME_PROJECT_RESET,
    };
};

export const renameProjectRequest = (): void => {
    return {
        type: types.RENAME_PROJECT_REQUEST,
    };
};

export const renameProjectSuccess = (project: $TSFixMe): void => {
    return {
        type: types.RENAME_PROJECT_SUCCESS,
        payload: project.data,
    };
};

export const renameProjectError = (error: ErrorPayload): void => {
    return {
        type: types.RENAME_PROJECT_FAILED,
        payload: error,
    };
};

export const renameProject = (
    projectId: string,
    projectName: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put(`project/${projectId}/renameProject`, {
            projectName,
        });

        dispatch(renameProjectRequest());

        promise
            .then(
                function (project): void {
                    dispatch(renameProjectSuccess(project));
                    return project;
                },
                function (error): void {
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
                    dispatch(renameProjectError(error));
                }
            )
            .then(function (): void {
                dispatch(renameProjectReset());
            });

        return promise;
    };
};

export const deleteProjectRequest = (): void => {
    return {
        type: types.DELETE_PROJECT_REQUEST,
    };
};

export const deleteProjectSuccess = (projectId: string): void => {
    return {
        type: types.DELETE_PROJECT_SUCCESS,
        payload: projectId,
    };
};

export const deleteProjectError = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_PROJECT_FAILED,
        payload: error,
    };
};

export const deleteProject = (projectId: string, feedback: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise = delete (`project/${projectId}/deleteProject`,
        {
            projectId,
            feedback,
        });

        dispatch(deleteProjectRequest());

        promise.then(
            function (): void {
                dispatch(deleteProjectSuccess(projectId));
                dispatch(deleteProjectIncidents(projectId));
                dispatch(deleteProjectSchedules(projectId));
                dispatch(deleteProjectMonitors(projectId));
                dispatch(deleteProjectStatusPages(projectId));
            },
            function (error): void {
                dispatch(deleteProjectError(error));
            }
        );

        return promise;
    };
};

export const changePlanReset = (): void => {
    return {
        type: types.CHANGE_PLAN_RESET,
    };
};

export const changePlanRequest = (): void => {
    return {
        type: types.CHANGE_PLAN_REQUEST,
    };
};

export const changePlanSuccess = (project: $TSFixMe): void => {
    return {
        type: types.CHANGE_PLAN_SUCCESS,
        payload: project.data,
    };
};

export const changePlanError = (error: ErrorPayload): void => {
    return {
        type: types.CHANGE_PLAN_FAILED,
        payload: error,
    };
};

export function changePlan(
    projectId: string,
    planId: $TSFixMe,
    projectName: $TSFixMe,
    oldPlan: $TSFixMe,
    newPlan: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(`project/${projectId}/changePlan`, {
            projectName,
            planId,
            oldPlan,
            newPlan,
        });

        dispatch(changePlanRequest());

        promise
            .then(
                function (project): void {
                    dispatch(changePlanSuccess(project));
                },
                function (error): void {
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
                    dispatch(changePlanError(error));
                }
            )
            .then(function (): void {
                dispatch(changePlanReset());
            });

        return promise;
    };
}

export function upgradeToEnterpriseMail(
    projectId: string,
    projectName: $TSFixMe,
    oldPlan: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
            `project/${projectId}/upgradeToEnterprise`,
            {
                projectName,
                oldPlan,
            }
        );

        dispatch(changePlanRequest());

        promise
            .then(
                function (project): void {
                    dispatch(changePlanSuccess(project));
                },
                function (error): void {
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
                    dispatch(changePlanError(error));
                }
            )
            .then(function (): void {
                dispatch(changePlanReset());
            });

        return promise;
    };
}

// Calls the API to delete team member.

export const exitProjectRequest = (): void => {
    return {
        type: types.EXIT_PROJECT_REQUEST,
    };
};

export const exitProjectSuccess = (userId: string): void => {
    return {
        type: types.EXIT_PROJECT_SUCCESS,
        payload: userId,
    };
};

export const exitProjectError = (error: ErrorPayload): void => {
    return {
        type: types.EXIT_PROJECT_FAILED,
        payload: error,
    };
};

export const exitProject = (projectId: string, userId: string): void => {
    return function (dispatch: Dispatch): void {
        const promise =
            delete (`project/${projectId}/user/${userId}/exitProject`, null);
        dispatch(exitProjectRequest());

        promise.then(
            function (): void {
                dispatch(exitProjectSuccess({ projectId, userId }));
            },
            function (error): void {
                dispatch(exitProjectError(error));
            }
        );

        return promise;
    };
};

export const changeProjectRoles = (team: $TSFixMe): void => {
    return {
        type: types.CHANGE_PROJECT_ROLES,
        payload: team,
    };
};

// Calls API to mark project for removal
export const markProjectForDeleteRequest = (): void => {
    return {
        type: types.MARK_PROJECT_DELETE_REQUEST,
    };
};

export const markProjectForDeleteSuccess = (projectId: string): void => {
    return {
        type: types.MARK_PROJECT_DELETE_SUCCESS,
        payload: projectId,
    };
};

export const markProjectForDeleteError = (error: ErrorPayload): void => {
    return {
        type: types.MARK_PROJECT_DELETE_FAILED,
        payload: error,
    };
};

export const markProjectForDelete = (
    projectId: string,
    feedback: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = delete (`project/${projectId}/deleteProject`,
        {
            projectId,
            feedback,
        });

        dispatch(markProjectForDeleteRequest());

        promise.then(
            function (): void {
                dispatch(markProjectForDeleteSuccess(projectId));
            },
            function (error): void {
                dispatch(markProjectForDeleteError(error));
            }
        );

        return promise;
    };
};

export const alertOptionsUpdateRequest = (): void => {
    return {
        type: types.ALERT_OPTIONS_UPDATE_REQUEST,
    };
};

export const alertOptionsUpdateSuccess = (project: $TSFixMe): void => {
    return {
        type: types.ALERT_OPTIONS_UPDATE_SUCCESS,
        payload: project.data,
    };
};

export const alertOptionsUpdateError = (error: ErrorPayload): void => {
    return {
        type: types.ALERT_OPTIONS_UPDATE_FAILED,
        payload: error,
    };
};

export const alertOptionsUpdate = (
    projectId: string,
    alertData: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put(
            `project/${projectId}/alertOptions`,
            alertData
        );

        dispatch(alertOptionsUpdateRequest());

        promise.then(
            function (project): void {
                dispatch(alertOptionsUpdateSuccess(project));
            },
            function (error): void {
                dispatch(alertOptionsUpdateError(error));
            }
        );
        return promise;
    };
};

export const addBalanceRequest = (): void => {
    return {
        type: types.ADD_BALANCE_REQUEST,
    };
};

export const addBalanceSuccess = (pi: $TSFixMe): void => {
    return {
        type: types.ADD_BALANCE_SUCCESS,
        payload: pi.data,
    };
};

export const addBalanceError = (error: ErrorPayload): void => {
    return {
        type: types.ADD_BALANCE_FAILED,
        payload: error,
    };
};

export const addBalance = (projectId: string, data: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(`stripe/${projectId}/addBalance`, data);

        dispatch(addBalanceRequest());

        promise.then(
            function (pi): void {
                dispatch(addBalanceSuccess(pi));
            },
            function (error): void {
                dispatch(addBalanceError(error));
            }
        );
        return promise;
    };
};

export const updateProjectBalanceRequest = (): void => {
    return {
        type: types.UPDATE_PROJECT_BALANCE_REQUEST,
    };
};

export const updateProjectBalanceSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.UPDATE_PROJECT_BALANCE_SUCCESS,
        payload,
    };
};

export const updateProjectBalanceFailure = (error: ErrorPayload): void => {
    return {
        type: types.UPDATE_PROJECT_BALANCE_FAILURE,
        payload: error,
    };
};

export const updateProjectBalance =
    ({ projectId, intentId }: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        dispatch(updateProjectBalanceRequest());

        try {
            const response = await BackendAPI.get(
                `stripe/${projectId}/updateBalance/${intentId}`
            );

            dispatch(updateProjectBalanceSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(updateProjectBalanceFailure(errorMsg));
        }
    };

export const checkCardRequest = (promise: $TSFixMe): void => {
    return {
        type: types.CHECK_CARD_REQUEST,
        payload: promise,
    };
};

export const checkCardFailed = (error: ErrorPayload): void => {
    return {
        type: types.CHECK_CARD_FAILED,
        payload: error,
    };
};

export const checkCardSuccess = (card: $TSFixMe): void => {
    return {
        type: types.CHECK_CARD_SUCCESS,
        payload: card,
    };
};

export const checkCard = (data: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(new Route('stripe/checkCard'), data);

        dispatch(checkCardRequest(promise));

        promise.then(
            function (card): void {
                dispatch(checkCardSuccess(card.data));
            },
            function (error): void {
                dispatch(checkCardFailed(error));
            }
        );
        return promise;
    };
};

export const setEmailNotificationRequest = (): void => {
    return {
        type: types.SET_EMAIL_INCIDENT_NOTIFICATION_REQUEST,
    };
};

export const setEmailNotificationSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.SET_EMAIL_INCIDENT_NOTIFICATION_SUCCESS,
        payload,
    };
};

export const setEmailNotificationFailure = (error: ErrorPayload): void => {
    return {
        type: types.SET_EMAIL_INCIDENT_NOTIFICATION_FAILURE,
        payload: error,
    };
};

export const setEmailNotification = ({ projectId, data }: $TSFixMe): void => {
    return async function (dispatch: Dispatch): void {
        dispatch(setEmailNotificationRequest());

        try {
            const response = await BackendAPI.put(
                `project/${projectId}/advancedOptions/email`,
                data
            );

            dispatch(setEmailNotificationSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(setEmailNotificationFailure(errorMsg));
        }
    };
};

export const setSmsNotificationRequest = (): void => {
    return {
        type: types.SET_SMS_INCIDENT_NOTIFICATION_REQUEST,
    };
};

export const setSmsNotificationSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.SET_SMS_INCIDENT_NOTIFICATION_SUCCESS,
        payload,
    };
};

export const setSmsNotificationFailure = (error: ErrorPayload): void => {
    return {
        type: types.SET_SMS_INCIDENT_NOTIFICATION_FAILURE,
        payload: error,
    };
};

export const setSmsNotification = ({ projectId, data }: $TSFixMe): void => {
    return async function (dispatch: Dispatch): void {
        dispatch(setSmsNotificationRequest());

        try {
            const response = await BackendAPI.put(
                `project/${projectId}/advancedOptions/sms`,
                data
            );

            dispatch(setSmsNotificationSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(setSmsNotificationFailure(errorMsg));
        }
    };
};

/* for webhook notification settings */
export const setWebhookNotificationSettingsRequest = (): void => {
    return {
        type: types.SET_WEBHOOK_NOTIFICATION_SETTINGS_REQUEST,
    };
};

export const setWebhookNotificationSettingsSuccess = (
    payload: $TSFixMe
): void => {
    return {
        type: types.SET_WEBHOOK_NOTIFICATION_SETTINGS_SUCCESS,
        payload,
    };
};

export const setWebhookNotificationSettingsFailure = (
    error: ErrorPayload
): void => {
    return {
        type: types.SET_WEBHOOK_NOTIFICATION_SETTINGS_FAILURE,
        payload: error,
    };
};

export const setWebhookNotificationSettings = ({
    projectId,
    data,
}: $TSFixMe) => {
    return async function (dispatch: Dispatch): void {
        dispatch(setWebhookNotificationSettingsRequest());

        try {
            const response = await BackendAPI.put(
                `project/${projectId}/advancedOptions/webhook`,
                data
            );

            dispatch(setWebhookNotificationSettingsSuccess(response.data));
        } catch (error) {
            const errorMessage =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(setWebhookNotificationSettingsFailure(errorMessage));
        }
    };
};

/* for project wide domains */
export const createProjectDomainRequest = (): void => {
    return {
        type: types.CREATE_PROJECT_DOMAIN_REQUEST,
    };
};

export const createProjectDomainSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.CREATE_PROJECT_DOMAIN_SUCCESS,
        payload,
    };
};

export const createProjectDomainFailure = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
};

export const resetCreateProjectDomain = (): void => {
    return {
        type: types.RESET_CREATE_PROJECT_DOMAIN,
    };
};

export const createProjectDomain = ({ projectId, data }: $TSFixMe): void => {
    return async function (dispatch: Dispatch): void {
        dispatch(createProjectDomainRequest());

        try {
            const response = await BackendAPI.post(
                `domainVerificationToken/${projectId}/domain`,
                data
            );

            dispatch(createProjectDomainSuccess(response.data));

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
            dispatch(createProjectDomainFailure(errorMessage));
        }
    };
};

export const fetchProjectDomainsRequest = (): void => {
    return {
        type: types.FETCH_PROJECT_DOMAINS_REQUEST,
    };
};

export const fetchProjectDomainsSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_PROJECT_DOMAINS_SUCCESS,
        payload,
    };
};

export const fetchProjectDomainsFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_PROJECT_DOMAINS_FAILURE,
        payload: error,
    };
};

export const fetchProjectDomains = (
    projectId: string,
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

export const updateProjectDomainRequest = (): void => {
    return {
        type: types.UPDATE_PROJECT_DOMAIN_REQUEST,
    };
};

export const updateProjectDomainSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.UPDATE_PROJECT_DOMAIN_SUCCESS,
        payload,
    };
};

export const updateProjectDomainFailure = (error: ErrorPayload): void => {
    return {
        type: types.UPDATE_PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
};

export const resetUpdateProjectDomain = (): void => {
    return {
        type: types.RESET_UPDATE_PROJECT_DOMAIN,
    };
};

export const updateProjectDomain = ({
    projectId,
    domainId,
    data,
}: $TSFixMe) => {
    return async function (dispatch: Dispatch): void {
        dispatch(updateProjectDomainRequest());

        try {
            const response = await BackendAPI.put(
                `domainVerificationToken/${projectId}/domain/${domainId}`,
                data
            );

            dispatch(updateProjectDomainSuccess(response.data));

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
            dispatch(updateProjectDomainFailure(errorMessage));
        }
    };
};

export const verifyProjectDomainRequest = (): void => {
    return {
        type: types.VERIFY_PROJECT_DOMAIN_REQUEST,
    };
};

export const verifyProjectDomainSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.VERIFY_PROJECT_DOMAIN_SUCCESS,
        payload,
    };
};

export const verifyProjectDomainFailure = (error: ErrorPayload): void => {
    return {
        type: types.VERIFY_PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
};

export const resetVerifyProjectDomain = (): void => {
    return {
        type: types.RESET_VERIFY_PROJECT_DOMAIN,
    };
};

export const verifyProjectDomain = ({
    projectId,
    domainId,
    data,
}: $TSFixMe) => {
    return async function (dispatch: Dispatch): void {
        dispatch(verifyProjectDomainRequest());

        try {
            const response = await BackendAPI.put(
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
};

export const deleteProjectDomainRequest = (): void => {
    return {
        type: types.DELETE_PROJECT_DOMAIN_REQUEST,
    };
};

export const deleteProjectDomainSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.DELETE_PROJECT_DOMAIN_SUCCESS,
        payload,
    };
};

export const deleteProjectDomainFailure = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
};

export const resetDeleteProjectDomain = (): void => {
    return {
        type: types.RESET_DELETE_PROJECT_DOMAIN,
    };
};

export const deleteProjectDomain = ({
    projectId,
    domainId,
}: $TSFixMe): void => {
    return async function (dispatch: Dispatch): void {
        dispatch(deleteProjectDomainRequest());

        try {
            const response =
                await delete `domainVerificationToken/${projectId}/domain/${domainId}`;

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
};

export const fetchTrialReset = (): void => {
    return {
        type: types.RESET_FETCH_TRIAL,
    };
};

export const fetchTrialRequest = (): void => {
    return {
        type: types.FETCH_TRIAL_REQUEST,
    };
};

export const fetchTrialSuccess = (response: $TSFixMe): void => {
    return {
        type: types.FETCH_TRIAL_SUCCESS,
        payload: response.data,
    };
};

export const fetchTrialError = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_TRIAL_FAILURE,
        payload: error,
    };
};

export const fetchTrial = (projectId: string): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(`stripe/${projectId}/getTrial`);

        dispatch(fetchTrialRequest());

        promise.then(
            function (response): void {
                dispatch(fetchTrialSuccess(response));
            },
            function (error): void {
                dispatch(fetchTrialError(error));
            }
        );

        return promise;
    };
};

export const fetchProjectSlugRequest = (): void => {
    return {
        type: types.FETCH_PROJECT_SLUG_REQUEST,
    };
};

export const fetchProjectSlugSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_PROJECT_SLUG_SUCCESS,
        payload,
    };
};

export const fetchProjectSlugFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_PROJECT_SLUG_FAILURE,
        payload: error,
    };
};

export const fetchProjectSlug = (slug: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(`project/project-slug/${slug}`);

        dispatch(fetchProjectSlugRequest());

        promise.then(
            function (response): void {
                dispatch(fetchProjectSlugSuccess(response.data));
            },
            function (error): void {
                const errorMsg =
                    error.response && error.response.data
                        ? error.response.data
                        : error.data
                        ? error.data
                        : error.message
                        ? error.message
                        : 'Network Error';
                dispatch(fetchProjectSlugFailure(errorMsg));
            }
        );

        return promise;
    };
};
