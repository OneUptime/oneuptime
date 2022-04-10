import BackendAPI from 'common-ui/src/utils/api/backend';
import Route from 'common/Types/api/route';
import { Dispatch } from 'redux';
import * as types from '../constants/project';
import { User, IS_SAAS_SERVICE } from '../config.js';
import { history } from '../store';
import ErrorPayload from 'common-ui/src/payload-types/error';
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

export const changeDeleteModal = () => {
    return {
        type: types.CHANGE_DELETE_MODAL,
    };
};

export const showDeleteModal = () => {
    return {
        type: types.SHOW_DELETE_MODAL,
    };
};

export const hideDeleteModal = () => {
    return {
        type: types.HIDE_DELETE_MODAL,
    };
};

export const hideDeleteModalSaasMode = () => {
    return {
        type: types.HIDE_DELETE_MODAL_SAAS_MODE,
    };
};

export const showForm = () => {
    return {
        type: types.SHOW_PROJECT_FORM,
    };
};

export const hideForm = () => {
    return {
        type: types.HIDE_PROJECT_FORM,
    };
};

export const showUpgradeForm = () => {
    return {
        type: types.SHOW_UPGRADE_FORM,
    };
};

export const hideUpgradeForm = () => {
    return {
        type: types.HIDE_UPGRADE_FORM,
    };
};

// Sets the whether the user can upgrade(canUpgrade) their plan
// if their returned plan list is empty or not.
export const upgradePlanEmpty = () => {
    return {
        type: types.UPGRADE_PLAN_EMPTY,
    };
};

export const projectsRequest = (promise: $TSFixMe) => {
    return {
        type: types.PROJECTS_REQUEST,
        payload: promise,
    };
};

export const projectsError = (error: ErrorPayload) => {
    return {
        type: types.PROJECTS_FAILED,
        payload: error,
    };
};

export const projectsSuccess = (projects: $TSFixMe) => {
    return {
        type: types.PROJECTS_SUCCESS,
        payload: projects,
    };
};

export const resetProjects = () => {
    return {
        type: types.PROJECTS_RESET,
    };
};

export const getProjects = (switchToProjectId: string) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `project/projects?skip=${0}&limit=${9999}`,

            null
        );
        dispatch(projectsRequest(promise));

        promise.then(
            function (projects) {
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
            function (error) {
                dispatch(projectsError(error));
            }
        );

        return promise;
    };
};

export const getProjectBalanceRequest = () => {
    return {
        type: types.GET_PROJECT_BALANCE_REQUEST,
    };
};
export const getprojectError = (error: ErrorPayload) => {
    return {
        type: types.GET_PROJECT_BALANCE_FAILED,
        payload: error,
    };
};
export const getProjectBalanceSuccess = (project: $TSFixMe) => {
    return {
        type: types.GET_PROJECT_BALANCE_SUCCESS,
        payload: project,
    };
};

export const getProjectBalance = (projectId: string) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(`project/${projectId}/balance`, null);

        dispatch(getProjectBalanceRequest(promise));

        promise.then(
            function (balance) {
                dispatch(getProjectBalanceSuccess(balance.data));
            },
            function (error) {
                dispatch(getprojectError(error));
            }
        );
    };
};
export const createProjectRequest = () => {
    return {
        type: types.CREATE_PROJECT_REQUEST,
    };
};

export const createProjectError = (error: ErrorPayload) => {
    return {
        type: types.CREATE_PROJECT_FAILED,
        payload: error,
    };
};

export const createProjectSuccess = (project: $TSFixMe) => {
    return {
        type: types.CREATE_PROJECT_SUCCESS,
        payload: project,
    };
};

export const resetCreateProject = () => {
    return {
        type: types.CREATE_PROJECT_RESET,
    };
};

export const createProject = (values: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(new Route('project/create'), values);

        dispatch(createProjectRequest());

        return promise.then(
            function (project) {
                if (IS_SAAS_SERVICE) {
                    User.setCardRegistered(true);
                }

                dispatch(createProjectSuccess(project.data));

                return project.data;
            },
            function (error) {
                dispatch(createProjectError(error));
            }
        );
    };
};

export function switchToProjectViewerNav(
    userId: string,
    subProjects: $TSFixMe,
    currentProject: $TSFixMe
) {
    return function (dispatch: Dispatch) {
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
) {
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
            history.push(`/dashboard/project/${project.slug}/status-pages`);
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

export const switchProjectReset = () => {
    return {
        type: types.SWITCH_PROJECT_RESET,
    };
};

export const showProjectSwitcher = () => {
    return {
        type: types.SHOW_PROJECT_SWITCHER,
    };
};

export const hideProjectSwitcher = () => {
    return {
        type: types.HIDE_PROJECT_SWITCHER,
    };
};

export const resetProjectTokenReset = () => {
    return {
        type: types.RESET_PROJECT_TOKEN_RESET,
    };
};

export const resetProjectTokenRequest = () => {
    return {
        type: types.RESET_PROJECT_TOKEN_REQUEST,
    };
};

export const resetProjectTokenSuccess = (project: $TSFixMe) => {
    return {
        type: types.RESET_PROJECT_TOKEN_SUCCESS,
        payload: project.data,
    };
};

export const resetProjectTokenError = (error: ErrorPayload) => {
    return {
        type: types.RESET_PROJECT_TOKEN_FAILED,
        payload: error,
    };
};

export const resetProjectToken = (projectId: string) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(`project/${projectId}/resetToken`);

        dispatch(resetProjectTokenRequest());

        promise
            .then(
                function (project) {
                    dispatch(resetProjectTokenSuccess(project));
                },
                function (error) {
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
            .then(function () {
                dispatch(resetProjectTokenReset());
            });

        return promise;
    };
};

export const renameProjectReset = () => {
    return {
        type: types.RENAME_PROJECT_RESET,
    };
};

export const renameProjectRequest = () => {
    return {
        type: types.RENAME_PROJECT_REQUEST,
    };
};

export const renameProjectSuccess = (project: $TSFixMe) => {
    return {
        type: types.RENAME_PROJECT_SUCCESS,
        payload: project.data,
    };
};

export const renameProjectError = (error: ErrorPayload) => {
    return {
        type: types.RENAME_PROJECT_FAILED,
        payload: error,
    };
};

export const renameProject = (projectId: string, projectName: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(`project/${projectId}/renameProject`, {
            projectName,
        });

        dispatch(renameProjectRequest());

        promise
            .then(
                function (project) {
                    dispatch(renameProjectSuccess(project));
                    return project;
                },
                function (error) {
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
            .then(function () {
                dispatch(renameProjectReset());
            });

        return promise;
    };
};

export const deleteProjectRequest = () => {
    return {
        type: types.DELETE_PROJECT_REQUEST,
    };
};

export const deleteProjectSuccess = (projectId: string) => {
    return {
        type: types.DELETE_PROJECT_SUCCESS,
        payload: projectId,
    };
};

export const deleteProjectError = (error: ErrorPayload) => {
    return {
        type: types.DELETE_PROJECT_FAILED,
        payload: error,
    };
};

export const deleteProject = (projectId: string, feedback: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = delete (`project/${projectId}/deleteProject`,
        {
            projectId,
            feedback,
        });

        dispatch(deleteProjectRequest());

        promise.then(
            function () {
                dispatch(deleteProjectSuccess(projectId));
                dispatch(deleteProjectIncidents(projectId));
                dispatch(deleteProjectSchedules(projectId));
                dispatch(deleteProjectMonitors(projectId));
                dispatch(deleteProjectStatusPages(projectId));
            },
            function (error) {
                dispatch(deleteProjectError(error));
            }
        );

        return promise;
    };
};

export const changePlanReset = () => {
    return {
        type: types.CHANGE_PLAN_RESET,
    };
};

export const changePlanRequest = () => {
    return {
        type: types.CHANGE_PLAN_REQUEST,
    };
};

export const changePlanSuccess = (project: $TSFixMe) => {
    return {
        type: types.CHANGE_PLAN_SUCCESS,
        payload: project.data,
    };
};

export const changePlanError = (error: ErrorPayload) => {
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
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(`project/${projectId}/changePlan`, {
            projectName,
            planId,
            oldPlan,
            newPlan,
        });

        dispatch(changePlanRequest());

        promise
            .then(
                function (project) {
                    dispatch(changePlanSuccess(project));
                },
                function (error) {
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
            .then(function () {
                dispatch(changePlanReset());
            });

        return promise;
    };
}

export function upgradeToEnterpriseMail(
    projectId: string,
    projectName: $TSFixMe,
    oldPlan: $TSFixMe
) {
    return function (dispatch: Dispatch) {
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
                function (project) {
                    dispatch(changePlanSuccess(project));
                },
                function (error) {
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
            .then(function () {
                dispatch(changePlanReset());
            });

        return promise;
    };
}

// Calls the API to delete team member.

export const exitProjectRequest = () => {
    return {
        type: types.EXIT_PROJECT_REQUEST,
    };
};

export const exitProjectSuccess = (userId: string) => {
    return {
        type: types.EXIT_PROJECT_SUCCESS,
        payload: userId,
    };
};

export const exitProjectError = (error: ErrorPayload) => {
    return {
        type: types.EXIT_PROJECT_FAILED,
        payload: error,
    };
};

export const exitProject = (projectId: string, userId: string) => {
    return function (dispatch: Dispatch) {
        const promise =
            delete (`project/${projectId}/user/${userId}/exitProject`, null);
        dispatch(exitProjectRequest());

        promise.then(
            function () {
                dispatch(exitProjectSuccess({ projectId, userId }));
            },
            function (error) {
                dispatch(exitProjectError(error));
            }
        );

        return promise;
    };
};

export const changeProjectRoles = (team: $TSFixMe) => {
    return {
        type: types.CHANGE_PROJECT_ROLES,
        payload: team,
    };
};

// Calls API to mark project for removal
export const markProjectForDeleteRequest = () => {
    return {
        type: types.MARK_PROJECT_DELETE_REQUEST,
    };
};

export const markProjectForDeleteSuccess = (projectId: string) => {
    return {
        type: types.MARK_PROJECT_DELETE_SUCCESS,
        payload: projectId,
    };
};

export const markProjectForDeleteError = (error: ErrorPayload) => {
    return {
        type: types.MARK_PROJECT_DELETE_FAILED,
        payload: error,
    };
};

export const markProjectForDelete = (projectId: string, feedback: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = delete (`project/${projectId}/deleteProject`,
        {
            projectId,
            feedback,
        });

        dispatch(markProjectForDeleteRequest());

        promise.then(
            function () {
                dispatch(markProjectForDeleteSuccess(projectId));
            },
            function (error) {
                dispatch(markProjectForDeleteError(error));
            }
        );

        return promise;
    };
};

export const alertOptionsUpdateRequest = () => {
    return {
        type: types.ALERT_OPTIONS_UPDATE_REQUEST,
    };
};

export const alertOptionsUpdateSuccess = (project: $TSFixMe) => {
    return {
        type: types.ALERT_OPTIONS_UPDATE_SUCCESS,
        payload: project.data,
    };
};

export const alertOptionsUpdateError = (error: ErrorPayload) => {
    return {
        type: types.ALERT_OPTIONS_UPDATE_FAILED,
        payload: error,
    };
};

export const alertOptionsUpdate = (projectId: string, alertData: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(
            `project/${projectId}/alertOptions`,
            alertData
        );

        dispatch(alertOptionsUpdateRequest());

        promise.then(
            function (project) {
                dispatch(alertOptionsUpdateSuccess(project));
            },
            function (error) {
                dispatch(alertOptionsUpdateError(error));
            }
        );
        return promise;
    };
};

export const addBalanceRequest = () => {
    return {
        type: types.ADD_BALANCE_REQUEST,
    };
};

export const addBalanceSuccess = (pi: $TSFixMe) => {
    return {
        type: types.ADD_BALANCE_SUCCESS,
        payload: pi.data,
    };
};

export const addBalanceError = (error: ErrorPayload) => {
    return {
        type: types.ADD_BALANCE_FAILED,
        payload: error,
    };
};

export const addBalance = (projectId: string, data: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(`stripe/${projectId}/addBalance`, data);

        dispatch(addBalanceRequest());

        promise.then(
            function (pi) {
                dispatch(addBalanceSuccess(pi));
            },
            function (error) {
                dispatch(addBalanceError(error));
            }
        );
        return promise;
    };
};

export const updateProjectBalanceRequest = () => {
    return {
        type: types.UPDATE_PROJECT_BALANCE_REQUEST,
    };
};

export const updateProjectBalanceSuccess = (payload: $TSFixMe) => {
    return {
        type: types.UPDATE_PROJECT_BALANCE_SUCCESS,
        payload,
    };
};

export const updateProjectBalanceFailure = (error: ErrorPayload) => {
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

export const checkCardRequest = (promise: $TSFixMe) => {
    return {
        type: types.CHECK_CARD_REQUEST,
        payload: promise,
    };
};

export const checkCardFailed = (error: ErrorPayload) => {
    return {
        type: types.CHECK_CARD_FAILED,
        payload: error,
    };
};

export const checkCardSuccess = (card: $TSFixMe) => {
    return {
        type: types.CHECK_CARD_SUCCESS,
        payload: card,
    };
};

export const checkCard = (data: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(new Route('stripe/checkCard'), data);

        dispatch(checkCardRequest(promise));

        promise.then(
            function (card) {
                dispatch(checkCardSuccess(card.data));
            },
            function (error) {
                dispatch(checkCardFailed(error));
            }
        );
        return promise;
    };
};

export const setEmailNotificationRequest = () => {
    return {
        type: types.SET_EMAIL_INCIDENT_NOTIFICATION_REQUEST,
    };
};

export const setEmailNotificationSuccess = (payload: $TSFixMe) => {
    return {
        type: types.SET_EMAIL_INCIDENT_NOTIFICATION_SUCCESS,
        payload,
    };
};

export const setEmailNotificationFailure = (error: ErrorPayload) => {
    return {
        type: types.SET_EMAIL_INCIDENT_NOTIFICATION_FAILURE,
        payload: error,
    };
};

export const setEmailNotification = ({ projectId, data }: $TSFixMe) => {
    return async function (dispatch: Dispatch) {
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

export const setSmsNotificationRequest = () => {
    return {
        type: types.SET_SMS_INCIDENT_NOTIFICATION_REQUEST,
    };
};

export const setSmsNotificationSuccess = (payload: $TSFixMe) => {
    return {
        type: types.SET_SMS_INCIDENT_NOTIFICATION_SUCCESS,
        payload,
    };
};

export const setSmsNotificationFailure = (error: ErrorPayload) => {
    return {
        type: types.SET_SMS_INCIDENT_NOTIFICATION_FAILURE,
        payload: error,
    };
};

export const setSmsNotification = ({ projectId, data }: $TSFixMe) => {
    return async function (dispatch: Dispatch) {
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
export const setWebhookNotificationSettingsRequest = () => {
    return {
        type: types.SET_WEBHOOK_NOTIFICATION_SETTINGS_REQUEST,
    };
};

export const setWebhookNotificationSettingsSuccess = (payload: $TSFixMe) => {
    return {
        type: types.SET_WEBHOOK_NOTIFICATION_SETTINGS_SUCCESS,
        payload,
    };
};

export const setWebhookNotificationSettingsFailure = (error: ErrorPayload) => {
    return {
        type: types.SET_WEBHOOK_NOTIFICATION_SETTINGS_FAILURE,
        payload: error,
    };
};

export const setWebhookNotificationSettings = ({
    projectId,
    data,
}: $TSFixMe) => {
    return async function (dispatch: Dispatch) {
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
export const createProjectDomainRequest = () => {
    return {
        type: types.CREATE_PROJECT_DOMAIN_REQUEST,
    };
};

export const createProjectDomainSuccess = (payload: $TSFixMe) => {
    return {
        type: types.CREATE_PROJECT_DOMAIN_SUCCESS,
        payload,
    };
};

export const createProjectDomainFailure = (error: ErrorPayload) => {
    return {
        type: types.CREATE_PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
};

export const resetCreateProjectDomain = () => {
    return {
        type: types.RESET_CREATE_PROJECT_DOMAIN,
    };
};

export const createProjectDomain = ({ projectId, data }: $TSFixMe) => {
    return async function (dispatch: Dispatch) {
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

export const fetchProjectDomainsRequest = () => {
    return {
        type: types.FETCH_PROJECT_DOMAINS_REQUEST,
    };
};

export const fetchProjectDomainsSuccess = (payload: $TSFixMe) => {
    return {
        type: types.FETCH_PROJECT_DOMAINS_SUCCESS,
        payload,
    };
};

export const fetchProjectDomainsFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_PROJECT_DOMAINS_FAILURE,
        payload: error,
    };
};

export const fetchProjectDomains = (
    projectId: string,
    skip = 0,
    limit = 10
) => {
    return async function (dispatch: Dispatch) {
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

export const updateProjectDomainRequest = () => {
    return {
        type: types.UPDATE_PROJECT_DOMAIN_REQUEST,
    };
};

export const updateProjectDomainSuccess = (payload: $TSFixMe) => {
    return {
        type: types.UPDATE_PROJECT_DOMAIN_SUCCESS,
        payload,
    };
};

export const updateProjectDomainFailure = (error: ErrorPayload) => {
    return {
        type: types.UPDATE_PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
};

export const resetUpdateProjectDomain = () => {
    return {
        type: types.RESET_UPDATE_PROJECT_DOMAIN,
    };
};

export const updateProjectDomain = ({
    projectId,
    domainId,
    data,
}: $TSFixMe) => {
    return async function (dispatch: Dispatch) {
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

export const verifyProjectDomainRequest = () => {
    return {
        type: types.VERIFY_PROJECT_DOMAIN_REQUEST,
    };
};

export const verifyProjectDomainSuccess = (payload: $TSFixMe) => {
    return {
        type: types.VERIFY_PROJECT_DOMAIN_SUCCESS,
        payload,
    };
};

export const verifyProjectDomainFailure = (error: ErrorPayload) => {
    return {
        type: types.VERIFY_PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
};

export const resetVerifyProjectDomain = () => {
    return {
        type: types.RESET_VERIFY_PROJECT_DOMAIN,
    };
};

export const verifyProjectDomain = ({
    projectId,
    domainId,
    data,
}: $TSFixMe) => {
    return async function (dispatch: Dispatch) {
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

export const deleteProjectDomainRequest = () => {
    return {
        type: types.DELETE_PROJECT_DOMAIN_REQUEST,
    };
};

export const deleteProjectDomainSuccess = (payload: $TSFixMe) => {
    return {
        type: types.DELETE_PROJECT_DOMAIN_SUCCESS,
        payload,
    };
};

export const deleteProjectDomainFailure = (error: ErrorPayload) => {
    return {
        type: types.DELETE_PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
};

export const resetDeleteProjectDomain = () => {
    return {
        type: types.RESET_DELETE_PROJECT_DOMAIN,
    };
};

export const deleteProjectDomain = ({ projectId, domainId }: $TSFixMe) => {
    return async function (dispatch: Dispatch) {
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

export const fetchTrialReset = () => {
    return {
        type: types.RESET_FETCH_TRIAL,
    };
};

export const fetchTrialRequest = () => {
    return {
        type: types.FETCH_TRIAL_REQUEST,
    };
};

export const fetchTrialSuccess = (response: $TSFixMe) => {
    return {
        type: types.FETCH_TRIAL_SUCCESS,
        payload: response.data,
    };
};

export const fetchTrialError = (error: ErrorPayload) => {
    return {
        type: types.FETCH_TRIAL_FAILURE,
        payload: error,
    };
};

export const fetchTrial = (projectId: string) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(`stripe/${projectId}/getTrial`);

        dispatch(fetchTrialRequest());

        promise.then(
            function (response) {
                dispatch(fetchTrialSuccess(response));
            },
            function (error) {
                dispatch(fetchTrialError(error));
            }
        );

        return promise;
    };
};

export const fetchProjectSlugRequest = () => {
    return {
        type: types.FETCH_PROJECT_SLUG_REQUEST,
    };
};

export const fetchProjectSlugSuccess = (payload: $TSFixMe) => {
    return {
        type: types.FETCH_PROJECT_SLUG_SUCCESS,
        payload,
    };
};

export const fetchProjectSlugFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_PROJECT_SLUG_FAILURE,
        payload: error,
    };
};

export const fetchProjectSlug = (slug: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(`project/project-slug/${slug}`);

        dispatch(fetchProjectSlugRequest());

        promise.then(
            function (response) {
                dispatch(fetchProjectSlugSuccess(response.data));
            },
            function (error) {
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
