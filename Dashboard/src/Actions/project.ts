import BackendAPI from 'CommonUI/src/utils/api/backend';
import Route from 'Common/Types/api/route';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
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

export const changeDeleteModal: Function = (): void => {
    return {
        type: types.CHANGE_DELETE_MODAL,
    };
};

export const showDeleteModal: Function = (): void => {
    return {
        type: types.SHOW_DELETE_MODAL,
    };
};

export const hideDeleteModal: Function = (): void => {
    return {
        type: types.HIDE_DELETE_MODAL,
    };
};

export const hideDeleteModalSaasMode: Function = (): void => {
    return {
        type: types.HIDE_DELETE_MODAL_SAAS_MODE,
    };
};

export const showForm: Function = (): void => {
    return {
        type: types.SHOW_PROJECT_FORM,
    };
};

export const hideForm: Function = (): void => {
    return {
        type: types.HIDE_PROJECT_FORM,
    };
};

export const showUpgradeForm: Function = (): void => {
    return {
        type: types.SHOW_UPGRADE_FORM,
    };
};

export const hideUpgradeForm: Function = (): void => {
    return {
        type: types.HIDE_UPGRADE_FORM,
    };
};

// Sets the whether the user can upgrade(canUpgrade) their plan
// if their returned plan list is empty or not.
export const upgradePlanEmpty: Function = (): void => {
    return {
        type: types.UPGRADE_PLAN_EMPTY,
    };
};

export const projectsRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.PROJECTS_REQUEST,
        payload: promise,
    };
};

export const projectsError: Function = (error: ErrorPayload): void => {
    return {
        type: types.PROJECTS_FAILED,
        payload: error,
    };
};

export const projectsSuccess: Function = (projects: $TSFixMe): void => {
    return {
        type: types.PROJECTS_SUCCESS,
        payload: projects,
    };
};

export const resetProjects: Function = (): void => {
    return {
        type: types.PROJECTS_RESET,
    };
};

export const getProjects: Function = (switchToProjectId: ObjectID): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `project/projects?skip=${0}&limit=${9999}`,

            null
        );
        dispatch(projectsRequest(promise));

        promise.then(
            (projects): void => {
                projects = projects.data && projects.data.data;
                dispatch(projectsSuccess(projects));

                if (projects.length > 0 && !switchToProjectId) {
                    if (User.getCurrentProjectId()) {
                        const project: $TSFixMe = projects.filter(
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
                    let projectSwitched: $TSFixMe = false;

                    for (let i: $TSFixMe = 0; i < projects.length; i++) {
                        if (projects[i]._id === switchToProjectId) {
                            dispatch(switchProject(dispatch, projects[i]));
                            projectSwitched = true;
                        }
                    }
                    if (User.getCurrentProjectId() && !projectSwitched) {
                        const project: $TSFixMe = projects.filter(
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
            (error): void => {
                dispatch(projectsError(error));
            }
        );

        return promise;
    };
};

export const getProjectBalanceRequest: Function = (): void => {
    return {
        type: types.GET_PROJECT_BALANCE_REQUEST,
    };
};
export const getprojectError: Function = (error: ErrorPayload): void => {
    return {
        type: types.GET_PROJECT_BALANCE_FAILED,
        payload: error,
    };
};
export const getProjectBalanceSuccess: Function = (project: $TSFixMe): void => {
    return {
        type: types.GET_PROJECT_BALANCE_SUCCESS,
        payload: project,
    };
};

export const getProjectBalance: Function = (projectId: ObjectID): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `project/${projectId}/balance`,
            null
        );

        dispatch(getProjectBalanceRequest(promise));

        promise.then(
            (balance): void => {
                dispatch(getProjectBalanceSuccess(balance.data));
            },
            (error): void => {
                dispatch(getprojectError(error));
            }
        );
    };
};
export const createProjectRequest: Function = (): void => {
    return {
        type: types.CREATE_PROJECT_REQUEST,
    };
};

export const createProjectError: Function = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_PROJECT_FAILED,
        payload: error,
    };
};

export const createProjectSuccess: Function = (project: $TSFixMe): void => {
    return {
        type: types.CREATE_PROJECT_SUCCESS,
        payload: project,
    };
};

export const resetCreateProject: Function = (): void => {
    return {
        type: types.CREATE_PROJECT_RESET,
    };
};

export const createProject: Function = (values: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            new Route('project/create'),
            values
        );

        dispatch(createProjectRequest());

        return promise.then(
            (project): void => {
                if (IS_SAAS_SERVICE) {
                    User.setCardRegistered(true);
                }

                dispatch(createProjectSuccess(project.data));

                return project.data;
            },
            (error): void => {
                dispatch(createProjectError(error));
            }
        );
    };
};

export function switchToProjectViewerNav(
    userId: ObjectID,
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
    const currentProjectId: $TSFixMe = User.getCurrentProjectId();
    const historyProjectId: $TSFixMe =
        history.location.pathname.split('project')[1];

    //get project slug from pathname
    const pathname: $TSFixMe = history.location.pathname;
    const regex: $TSFixMe = new RegExp(
        '/dashboard/project/([A-z-0-9]+)/?.+',
        'i'
    );
    const match: $TSFixMe = pathname.match(regex);

    let projectSlug;
    if (match) {
        projectSlug = match[1];
    }

    const loggedInUser: $TSFixMe = User.getUserId();
    const switchToMainProject: $TSFixMe = project?.users.find(
        (user: $TSFixMe) => (user.userId._id || user.userId) === loggedInUser
    );

    // if the path is already pointing to project slug we do not need to switch projects
    // esp. if this is from a redirectTo
    if (project.slug === projectSlug) {
        // ensure we update current project in localStorage
        User.setCurrentProjectId(project._id);

        // remove accessToken from url from redirects
        const search: $TSFixMe = history.location.search;
        if (search) {
            const searchParams: $TSFixMe = new URLSearchParams(search);
            searchParams.delete('accessToken');
            history.push({
                pathname: history.location.pathname,
                search: searchParams.toString(),
            });
        }
    } else if (!currentProjectId || project._id !== currentProjectId) {
        const isViewer: $TSFixMe = isMainProjectViewer(
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

    const activesubProjectId: $TSFixMe = User.getActivesubProjectId(
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
                const { data }: $TSFixMe = res.data;
                const projectId: $TSFixMe = data[0]._id;
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

export const switchProjectReset: Function = (): void => {
    return {
        type: types.SWITCH_PROJECT_RESET,
    };
};

export const showProjectSwitcher: Function = (): void => {
    return {
        type: types.SHOW_PROJECT_SWITCHER,
    };
};

export const hideProjectSwitcher: Function = (): void => {
    return {
        type: types.HIDE_PROJECT_SWITCHER,
    };
};

export const resetProjectTokenReset: Function = (): void => {
    return {
        type: types.RESET_PROJECT_TOKEN_RESET,
    };
};

export const resetProjectTokenRequest: Function = (): void => {
    return {
        type: types.RESET_PROJECT_TOKEN_REQUEST,
    };
};

export const resetProjectTokenSuccess: Function = (project: $TSFixMe): void => {
    return {
        type: types.RESET_PROJECT_TOKEN_SUCCESS,
        payload: project.data,
    };
};

export const resetProjectTokenError: Function = (error: ErrorPayload): void => {
    return {
        type: types.RESET_PROJECT_TOKEN_FAILED,
        payload: error,
    };
};

export const resetProjectToken: Function = (projectId: ObjectID): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `project/${projectId}/resetToken`
        );

        dispatch(resetProjectTokenRequest());

        promise
            .then(
                (project): void => {
                    dispatch(resetProjectTokenSuccess(project));
                },
                (error): void => {
                    if (error && error.response && error.response.data) {
                        error = error.response.data;
                    }
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
            .then((): void => {
                dispatch(resetProjectTokenReset());
            });

        return promise;
    };
};

export const renameProjectReset: Function = (): void => {
    return {
        type: types.RENAME_PROJECT_RESET,
    };
};

export const renameProjectRequest: Function = (): void => {
    return {
        type: types.RENAME_PROJECT_REQUEST,
    };
};

export const renameProjectSuccess: Function = (project: $TSFixMe): void => {
    return {
        type: types.RENAME_PROJECT_SUCCESS,
        payload: project.data,
    };
};

export const renameProjectError: Function = (error: ErrorPayload): void => {
    return {
        type: types.RENAME_PROJECT_FAILED,
        payload: error,
    };
};

export const renameProject: Function = (
    projectId: ObjectID,
    projectName: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `project/${projectId}/renameProject`,
            {
                projectName,
            }
        );

        dispatch(renameProjectRequest());

        promise
            .then(
                (project): void => {
                    dispatch(renameProjectSuccess(project));
                    return project;
                },
                (error): void => {
                    if (error && error.response && error.response.data) {
                        error = error.response.data;
                    }
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
            .then((): void => {
                dispatch(renameProjectReset());
            });

        return promise;
    };
};

export const deleteProjectRequest: Function = (): void => {
    return {
        type: types.DELETE_PROJECT_REQUEST,
    };
};

export const deleteProjectSuccess: Function = (projectId: ObjectID): void => {
    return {
        type: types.DELETE_PROJECT_SUCCESS,
        payload: projectId,
    };
};

export const deleteProjectError: Function = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_PROJECT_FAILED,
        payload: error,
    };
};

export const deleteProject: Function = (
    projectId: ObjectID,
    feedback: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = delete (`project/${projectId}/deleteProject`,
        {
            projectId,
            feedback,
        });

        dispatch(deleteProjectRequest());

        promise.then(
            (): void => {
                dispatch(deleteProjectSuccess(projectId));
                dispatch(deleteProjectIncidents(projectId));
                dispatch(deleteProjectSchedules(projectId));
                dispatch(deleteProjectMonitors(projectId));
                dispatch(deleteProjectStatusPages(projectId));
            },
            (error): void => {
                dispatch(deleteProjectError(error));
            }
        );

        return promise;
    };
};

export const changePlanReset: Function = (): void => {
    return {
        type: types.CHANGE_PLAN_RESET,
    };
};

export const changePlanRequest: Function = (): void => {
    return {
        type: types.CHANGE_PLAN_REQUEST,
    };
};

export const changePlanSuccess: Function = (project: $TSFixMe): void => {
    return {
        type: types.CHANGE_PLAN_SUCCESS,
        payload: project.data,
    };
};

export const changePlanError: Function = (error: ErrorPayload): void => {
    return {
        type: types.CHANGE_PLAN_FAILED,
        payload: error,
    };
};

export function changePlan(
    projectId: ObjectID,
    planId: $TSFixMe,
    projectName: $TSFixMe,
    oldPlan: $TSFixMe,
    newPlan: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `project/${projectId}/changePlan`,
            {
                projectName,
                planId,
                oldPlan,
                newPlan,
            }
        );

        dispatch(changePlanRequest());

        promise
            .then(
                (project): void => {
                    dispatch(changePlanSuccess(project));
                },
                (error): void => {
                    if (error && error.response && error.response.data) {
                        error = error.response.data;
                    }
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
            .then((): void => {
                dispatch(changePlanReset());
            });

        return promise;
    };
}

export function upgradeToEnterpriseMail(
    projectId: ObjectID,
    projectName: $TSFixMe,
    oldPlan: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `project/${projectId}/upgradeToEnterprise`,
            {
                projectName,
                oldPlan,
            }
        );

        dispatch(changePlanRequest());

        promise
            .then(
                (project): void => {
                    dispatch(changePlanSuccess(project));
                },
                (error): void => {
                    if (error && error.response && error.response.data) {
                        error = error.response.data;
                    }
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
            .then((): void => {
                dispatch(changePlanReset());
            });

        return promise;
    };
}

// Calls the API to delete team member.

export const exitProjectRequest: Function = (): void => {
    return {
        type: types.EXIT_PROJECT_REQUEST,
    };
};

export const exitProjectSuccess: Function = (userId: ObjectID): void => {
    return {
        type: types.EXIT_PROJECT_SUCCESS,
        payload: userId,
    };
};

export const exitProjectError: Function = (error: ErrorPayload): void => {
    return {
        type: types.EXIT_PROJECT_FAILED,
        payload: error,
    };
};

export const exitProject: Function = (
    projectId: ObjectID,
    userId: ObjectID
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe =
            delete (`project/${projectId}/user/${userId}/exitProject`, null);
        dispatch(exitProjectRequest());

        promise.then(
            (): void => {
                dispatch(exitProjectSuccess({ projectId, userId }));
            },
            (error): void => {
                dispatch(exitProjectError(error));
            }
        );

        return promise;
    };
};

export const changeProjectRoles: Function = (team: $TSFixMe): void => {
    return {
        type: types.CHANGE_PROJECT_ROLES,
        payload: team,
    };
};

// Calls API to mark project for removal
export const markProjectForDeleteRequest: Function = (): void => {
    return {
        type: types.MARK_PROJECT_DELETE_REQUEST,
    };
};

export const markProjectForDeleteSuccess: Function = (
    projectId: ObjectID
): void => {
    return {
        type: types.MARK_PROJECT_DELETE_SUCCESS,
        payload: projectId,
    };
};

export const markProjectForDeleteError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.MARK_PROJECT_DELETE_FAILED,
        payload: error,
    };
};

export const markProjectForDelete: Function = (
    projectId: ObjectID,
    feedback: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = delete (`project/${projectId}/deleteProject`,
        {
            projectId,
            feedback,
        });

        dispatch(markProjectForDeleteRequest());

        promise.then(
            (): void => {
                dispatch(markProjectForDeleteSuccess(projectId));
            },
            (error): void => {
                dispatch(markProjectForDeleteError(error));
            }
        );

        return promise;
    };
};

export const alertOptionsUpdateRequest: Function = (): void => {
    return {
        type: types.ALERT_OPTIONS_UPDATE_REQUEST,
    };
};

export const alertOptionsUpdateSuccess: Function = (
    project: $TSFixMe
): void => {
    return {
        type: types.ALERT_OPTIONS_UPDATE_SUCCESS,
        payload: project.data,
    };
};

export const alertOptionsUpdateError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.ALERT_OPTIONS_UPDATE_FAILED,
        payload: error,
    };
};

export const alertOptionsUpdate: Function = (
    projectId: ObjectID,
    alertData: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `project/${projectId}/alertOptions`,
            alertData
        );

        dispatch(alertOptionsUpdateRequest());

        promise.then(
            (project): void => {
                dispatch(alertOptionsUpdateSuccess(project));
            },
            (error): void => {
                dispatch(alertOptionsUpdateError(error));
            }
        );
        return promise;
    };
};

export const addBalanceRequest: Function = (): void => {
    return {
        type: types.ADD_BALANCE_REQUEST,
    };
};

export const addBalanceSuccess: Function = (pi: $TSFixMe): void => {
    return {
        type: types.ADD_BALANCE_SUCCESS,
        payload: pi.data,
    };
};

export const addBalanceError: Function = (error: ErrorPayload): void => {
    return {
        type: types.ADD_BALANCE_FAILED,
        payload: error,
    };
};

export const addBalance: Function = (
    projectId: ObjectID,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `stripe/${projectId}/addBalance`,
            data
        );

        dispatch(addBalanceRequest());

        promise.then(
            (pi): void => {
                dispatch(addBalanceSuccess(pi));
            },
            (error): void => {
                dispatch(addBalanceError(error));
            }
        );
        return promise;
    };
};

export const updateProjectBalanceRequest: Function = (): void => {
    return {
        type: types.UPDATE_PROJECT_BALANCE_REQUEST,
    };
};

export const updateProjectBalanceSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.UPDATE_PROJECT_BALANCE_SUCCESS,
        payload,
    };
};

export const updateProjectBalanceFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_PROJECT_BALANCE_FAILURE,
        payload: error,
    };
};

export const updateProjectBalance: $TSFixMe =
    ({ projectId, intentId }: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        dispatch(updateProjectBalanceRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(
                `stripe/${projectId}/updateBalance/${intentId}`
            );

            dispatch(updateProjectBalanceSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
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

export const checkCardRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.CHECK_CARD_REQUEST,
        payload: promise,
    };
};

export const checkCardFailed: Function = (error: ErrorPayload): void => {
    return {
        type: types.CHECK_CARD_FAILED,
        payload: error,
    };
};

export const checkCardSuccess: Function = (card: $TSFixMe): void => {
    return {
        type: types.CHECK_CARD_SUCCESS,
        payload: card,
    };
};

export const checkCard: Function = (data: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            new Route('stripe/checkCard'),
            data
        );

        dispatch(checkCardRequest(promise));

        promise.then(
            (card): void => {
                dispatch(checkCardSuccess(card.data));
            },
            (error): void => {
                dispatch(checkCardFailed(error));
            }
        );
        return promise;
    };
};

export const setEmailNotificationRequest: Function = (): void => {
    return {
        type: types.SET_EMAIL_INCIDENT_NOTIFICATION_REQUEST,
    };
};

export const setEmailNotificationSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.SET_EMAIL_INCIDENT_NOTIFICATION_SUCCESS,
        payload,
    };
};

export const setEmailNotificationFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.SET_EMAIL_INCIDENT_NOTIFICATION_FAILURE,
        payload: error,
    };
};

export const setEmailNotification: Function = ({
    projectId,
    data,
}: $TSFixMe): void => {
    return async function (dispatch: Dispatch): void {
        dispatch(setEmailNotificationRequest());

        try {
            const response: $TSFixMe = await BackendAPI.put(
                `project/${projectId}/advancedOptions/email`,
                data
            );

            dispatch(setEmailNotificationSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
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

export const setSmsNotificationRequest: Function = (): void => {
    return {
        type: types.SET_SMS_INCIDENT_NOTIFICATION_REQUEST,
    };
};

export const setSmsNotificationSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.SET_SMS_INCIDENT_NOTIFICATION_SUCCESS,
        payload,
    };
};

export const setSmsNotificationFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.SET_SMS_INCIDENT_NOTIFICATION_FAILURE,
        payload: error,
    };
};

export const setSmsNotification: Function = ({
    projectId,
    data,
}: $TSFixMe): void => {
    return async function (dispatch: Dispatch): void {
        dispatch(setSmsNotificationRequest());

        try {
            const response: $TSFixMe = await BackendAPI.put(
                `project/${projectId}/advancedOptions/sms`,
                data
            );

            dispatch(setSmsNotificationSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
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
export const setWebhookNotificationSettingsRequest: Function = (): void => {
    return {
        type: types.SET_WEBHOOK_NOTIFICATION_SETTINGS_REQUEST,
    };
};

export const setWebhookNotificationSettingsSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.SET_WEBHOOK_NOTIFICATION_SETTINGS_SUCCESS,
        payload,
    };
};

export const setWebhookNotificationSettingsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.SET_WEBHOOK_NOTIFICATION_SETTINGS_FAILURE,
        payload: error,
    };
};

export const setWebhookNotificationSettings: Function = ({
    projectId,
    data,
}: $TSFixMe) => {
    return async function (dispatch: Dispatch): void {
        dispatch(setWebhookNotificationSettingsRequest());

        try {
            const response: $TSFixMe = await BackendAPI.put(
                `project/${projectId}/advancedOptions/webhook`,
                data
            );

            dispatch(setWebhookNotificationSettingsSuccess(response.data));
        } catch (error) {
            const errorMessage: $TSFixMe =
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
export const createProjectDomainRequest: Function = (): void => {
    return {
        type: types.CREATE_PROJECT_DOMAIN_REQUEST,
    };
};

export const createProjectDomainSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.CREATE_PROJECT_DOMAIN_SUCCESS,
        payload,
    };
};

export const createProjectDomainFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.CREATE_PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
};

export const resetCreateProjectDomain: Function = (): void => {
    return {
        type: types.RESET_CREATE_PROJECT_DOMAIN,
    };
};

export const createProjectDomain: Function = ({
    projectId,
    data,
}: $TSFixMe): void => {
    return async function (dispatch: Dispatch): void {
        dispatch(createProjectDomainRequest());

        try {
            const response: $TSFixMe = await BackendAPI.post(
                `domainVerificationToken/${projectId}/domain`,
                data
            );

            dispatch(createProjectDomainSuccess(response.data));

            return response.data;
        } catch (error) {
            const errorMessage: $TSFixMe =
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

export const fetchProjectDomainsRequest: Function = (): void => {
    return {
        type: types.FETCH_PROJECT_DOMAINS_REQUEST,
    };
};

export const fetchProjectDomainsSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.FETCH_PROJECT_DOMAINS_SUCCESS,
        payload,
    };
};

export const fetchProjectDomainsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_PROJECT_DOMAINS_FAILURE,
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
            const response: $TSFixMe = await BackendAPI.get(
                `domainVerificationToken/${projectId}/domains?skip=${skip}&limit=${limit}`
            );

            dispatch(fetchProjectDomainsSuccess(response.data));

            return response.data;
        } catch (error) {
            const errorMessage: $TSFixMe =
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

export const updateProjectDomainRequest: Function = (): void => {
    return {
        type: types.UPDATE_PROJECT_DOMAIN_REQUEST,
    };
};

export const updateProjectDomainSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.UPDATE_PROJECT_DOMAIN_SUCCESS,
        payload,
    };
};

export const updateProjectDomainFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
};

export const resetUpdateProjectDomain: Function = (): void => {
    return {
        type: types.RESET_UPDATE_PROJECT_DOMAIN,
    };
};

export const updateProjectDomain: Function = ({
    projectId,
    domainId,
    data,
}: $TSFixMe) => {
    return async function (dispatch: Dispatch): void {
        dispatch(updateProjectDomainRequest());

        try {
            const response: $TSFixMe = await BackendAPI.put(
                `domainVerificationToken/${projectId}/domain/${domainId}`,
                data
            );

            dispatch(updateProjectDomainSuccess(response.data));

            return response.data;
        } catch (error) {
            const errorMessage: $TSFixMe =
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

export const verifyProjectDomainFailure: Function = (
    error: ErrorPayload
): void => {
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
    data,
}: $TSFixMe) => {
    return async function (dispatch: Dispatch): void {
        dispatch(verifyProjectDomainRequest());

        try {
            const response: $TSFixMe = await BackendAPI.put(
                `domainVerificationToken/${projectId}/verify/${domainId}`,
                data
            );

            dispatch(verifyProjectDomainSuccess(response.data));

            return response.data;
        } catch (error) {
            const errorMessage: $TSFixMe =
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

export const deleteProjectDomainFailure: Function = (
    error: ErrorPayload
): void => {
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

        try {
            const response: $TSFixMe =
                await delete `domainVerificationToken/${projectId}/domain/${domainId}`;

            dispatch(deleteProjectDomainSuccess(response.data));

            return response.data;
        } catch (error) {
            const errorMessage: $TSFixMe =
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

export const fetchTrialReset: Function = (): void => {
    return {
        type: types.RESET_FETCH_TRIAL,
    };
};

export const fetchTrialRequest: Function = (): void => {
    return {
        type: types.FETCH_TRIAL_REQUEST,
    };
};

export const fetchTrialSuccess: Function = (response: $TSFixMe): void => {
    return {
        type: types.FETCH_TRIAL_SUCCESS,
        payload: response.data,
    };
};

export const fetchTrialError: Function = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_TRIAL_FAILURE,
        payload: error,
    };
};

export const fetchTrial: Function = (projectId: ObjectID): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `stripe/${projectId}/getTrial`
        );

        dispatch(fetchTrialRequest());

        promise.then(
            (response): void => {
                dispatch(fetchTrialSuccess(response));
            },
            (error): void => {
                dispatch(fetchTrialError(error));
            }
        );

        return promise;
    };
};

export const fetchProjectSlugRequest: Function = (): void => {
    return {
        type: types.FETCH_PROJECT_SLUG_REQUEST,
    };
};

export const fetchProjectSlugSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_PROJECT_SLUG_SUCCESS,
        payload,
    };
};

export const fetchProjectSlugFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_PROJECT_SLUG_FAILURE,
        payload: error,
    };
};

export const fetchProjectSlug: Function = (slug: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `project/project-slug/${slug}`
        );

        dispatch(fetchProjectSlugRequest());

        promise.then(
            (response): void => {
                dispatch(fetchProjectSlugSuccess(response.data));
            },
            (error): void => {
                const errorMsg: $TSFixMe =
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
