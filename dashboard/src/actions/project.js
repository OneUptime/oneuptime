import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/project';
import { User, IS_SAAS_SERVICE } from '../config.js';
import { history } from '../store';
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
import { getSubProjects, resetSubProjects } from './subProject';
import { resetFetchComponentResources } from './component';
import errors from '../errors';

export function changeDeleteModal() {
    return {
        type: types.CHANGE_DELETE_MODAL,
    };
}

export function showDeleteModal() {
    return {
        type: types.SHOW_DELETE_MODAL,
    };
}

export function hideDeleteModal() {
    return {
        type: types.HIDE_DELETE_MODAL,
    };
}

export function hideDeleteModalSaasMode() {
    return {
        type: types.HIDE_DELETE_MODAL_SAAS_MODE,
    };
}

export function showForm() {
    return {
        type: types.SHOW_PROJECT_FORM,
    };
}

export function hideForm() {
    return {
        type: types.HIDE_PROJECT_FORM,
    };
}

export function showUpgradeForm() {
    return {
        type: types.SHOW_UPGRADE_FORM,
    };
}

export function hideUpgradeForm() {
    return {
        type: types.HIDE_UPGRADE_FORM,
    };
}

// Sets the whether the user can upgrade(canUpgrade) their plan
// if their returned plan list is empty or not.
export function upgradePlanEmpty() {
    return {
        type: types.UPGRADE_PLAN_EMPTY,
    };
}

export function projectsRequest(promise) {
    return {
        type: types.PROJECTS_REQUEST,
        payload: promise,
    };
}

export function projectsError(error) {
    return {
        type: types.PROJECTS_FAILED,
        payload: error,
    };
}

export function projectsSuccess(projects) {
    return {
        type: types.PROJECTS_SUCCESS,
        payload: projects,
    };
}

export const resetProjects = () => {
    return {
        type: types.PROJECTS_RESET,
    };
};

export function getProjects(switchToProjectId) {
    return function(dispatch) {
        const promise = getApi('project/projects', null);
        dispatch(projectsRequest(promise));

        promise.then(
            function(projects) {
                projects = projects.data && projects.data.data;
                dispatch(projectsSuccess(projects));
                if (projects.length > 0 && !switchToProjectId) {
                    const project = projects.filter(
                        project =>
                            project._id === User.getCurrentProjectId()
                    );
                    if (User.getCurrentProjectId() && project) {
                        dispatch(switchProject(dispatch, project[0]));
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
                            project =>
                                project._id === User.getCurrentProjectId()
                        );
                        if(project.length > 0){
                            dispatch(switchProject(dispatch, project[0]));
                            projectSwitched = true;
                        }
                    }
                    !projectSwitched &&
                        dispatch(switchProject(dispatch, projects[0]));
                }
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
                dispatch(projectsError(errors(error)));
            }
        );

        return promise;
    };
}

export function getProjectBalanceRequest() {
    return {
        type: types.GET_PROJECT_BALANCE_REQUEST,
    };
}
export function getprojectError(error) {
    return {
        type: types.GET_PROJECT_BALANCE_FAILED,
        payload: error,
    };
}
export function getProjectBalanceSuccess(project) {
    return {
        type: types.GET_PROJECT_BALANCE_SUCCESS,
        payload: project,
    };
}

export function getProjectBalance(projectId) {
    return function(dispatch) {
        const promise = getApi(`project/${projectId}/balance`, null);
        dispatch(getProjectBalanceRequest(promise));

        promise.then(
            function(balance) {
                dispatch(getProjectBalanceSuccess(balance.data));
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
                dispatch(getprojectError(errors(error)));
            }
        );
    };
}
export function createProjectRequest() {
    return {
        type: types.CREATE_PROJECT_REQUEST,
    };
}

export function createProjectError(error) {
    return {
        type: types.CREATE_PROJECT_FAILED,
        payload: error,
    };
}

export function createProjectSuccess(project) {
    return {
        type: types.CREATE_PROJECT_SUCCESS,
        payload: project,
    };
}

export const resetCreateProject = () => {
    return {
        type: types.CREATE_PROJECT_RESET,
    };
};

export function createProject(values) {
    return function(dispatch) {
        const promise = postApi('project/create', values);

        dispatch(createProjectRequest());

        return promise.then(
            function(project) {
                if (IS_SAAS_SERVICE) {
                    User.setCardRegistered(true);
                }
                dispatch(createProjectSuccess(project.data));
                return project.data;
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
                dispatch(createProjectError(errors(error)));
            }
        );
    };
}

export function switchProject(dispatch, project) {
    const currentProjectId = User.getCurrentProjectId();
    const historyProjectId = history.location.pathname.split('project')[1];
    if (!currentProjectId || project._id !== currentProjectId) {
        history.push(`/dashboard/project/${project._id}`);
        User.setCurrentProjectId(project._id);
    } else if (historyProjectId && historyProjectId === '/') {
        history.push(`/dashboard/project/${project._id}`);
    }

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

    getSubProjects(project._id)(dispatch);
    fetchAlert(project._id)(dispatch);
    fetchSubProjectStatusPages(project._id)(dispatch);
    fetchComponents(project._id)(dispatch);
    fetchMonitors(project._id)(dispatch);
    fetchResourceCategories(project._id)(dispatch);
    fetchResourceCategoriesForNewResource(project._id)(dispatch);
    fetchUnresolvedIncidents(project._id)(dispatch);
    fetchSchedules(project._id)(dispatch);
    fetchSubProjectSchedules(project._id)(dispatch);
    fetchNotifications(project._id)(dispatch);
    fetchTutorial()(dispatch);
    User.setProject(JSON.stringify(project));

    return {
        type: types.SWITCH_PROJECT,
        payload: project,
    };
}

export function switchProjectReset() {
    return {
        type: types.SWITCH_PROJECT_RESET,
    };
}

export function showProjectSwitcher() {
    return {
        type: types.SHOW_PROJECT_SWITCHER,
    };
}

export function hideProjectSwitcher() {
    return {
        type: types.HIDE_PROJECT_SWITCHER,
    };
}

export function resetProjectTokenReset() {
    return {
        type: types.RESET_PROJECT_TOKEN_RESET,
    };
}

export function resetProjectTokenRequest() {
    return {
        type: types.RESET_PROJECT_TOKEN_REQUEST,
    };
}

export function resetProjectTokenSuccess(project) {
    return {
        type: types.RESET_PROJECT_TOKEN_SUCCESS,
        payload: project.data,
    };
}

export function resetProjectTokenError(error) {
    return {
        type: types.RESET_PROJECT_TOKEN_FAILED,
        payload: error,
    };
}

export function resetProjectToken(projectId) {
    return function(dispatch) {
        const promise = getApi(`project/${projectId}/resetToken`);

        dispatch(resetProjectTokenRequest());

        promise
            .then(
                function(project) {
                    dispatch(resetProjectTokenSuccess(project));
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
                    dispatch(resetProjectTokenError(errors(error)));
                }
            )
            .then(function() {
                dispatch(resetProjectTokenReset());
            });

        return promise;
    };
}

export function renameProjectReset() {
    return {
        type: types.RENAME_PROJECT_RESET,
    };
}

export function renameProjectRequest() {
    return {
        type: types.RENAME_PROJECT_REQUEST,
    };
}

export function renameProjectSuccess(project) {
    return {
        type: types.RENAME_PROJECT_SUCCESS,
        payload: project.data,
    };
}

export function renameProjectError(error) {
    return {
        type: types.RENAME_PROJECT_FAILED,
        payload: error,
    };
}

export function renameProject(projectId, projectName) {
    return function(dispatch) {
        const promise = putApi(`project/${projectId}/renameProject`, {
            projectName,
        });

        dispatch(renameProjectRequest());

        promise
            .then(
                function(project) {
                    dispatch(renameProjectSuccess(project));
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
                    dispatch(renameProjectError(errors(error)));
                }
            )
            .then(function() {
                dispatch(renameProjectReset());
            });

        return promise;
    };
}

export function deleteProjectRequest() {
    return {
        type: types.DELETE_PROJECT_REQUEST,
    };
}

export function deleteProjectSuccess(projectId) {
    return {
        type: types.DELETE_PROJECT_SUCCESS,
        payload: projectId,
    };
}

export function deleteProjectError(error) {
    return {
        type: types.DELETE_PROJECT_FAILED,
        payload: error,
    };
}

export function deleteProject(projectId, feedback) {
    return function(dispatch) {
        const promise = deleteApi(`project/${projectId}/deleteProject`, {
            projectId,
            feedback,
        });

        dispatch(deleteProjectRequest());

        promise.then(
            function() {
                dispatch(deleteProjectSuccess(projectId));
                dispatch(deleteProjectIncidents(projectId));
                dispatch(deleteProjectSchedules(projectId));
                dispatch(deleteProjectMonitors(projectId));
                dispatch(deleteProjectStatusPages(projectId));
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
                dispatch(deleteProjectError(errors(error)));
            }
        );

        return promise;
    };
}

export function changePlanReset() {
    return {
        type: types.CHANGE_PLAN_RESET,
    };
}

export function changePlanRequest() {
    return {
        type: types.CHANGE_PLAN_REQUEST,
    };
}

export function changePlanSuccess(project) {
    return {
        type: types.CHANGE_PLAN_SUCCESS,
        payload: project.data,
    };
}

export function changePlanError(error) {
    return {
        type: types.CHANGE_PLAN_FAILED,
        payload: error,
    };
}

export function changePlan(projectId, planId, projectName, oldPlan, newPlan) {
    return function(dispatch) {
        const promise = postApi(`project/${projectId}/changePlan`, {
            projectName,
            planId,
            oldPlan,
            newPlan,
        });

        dispatch(changePlanRequest());

        promise
            .then(
                function(project) {
                    dispatch(changePlanSuccess(project));
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
                    dispatch(changePlanError(errors(error)));
                }
            )
            .then(function() {
                dispatch(changePlanReset());
            });

        return promise;
    };
}

export function upgradeToEnterpriseMail(projectId, projectName, oldPlan) {
    return function(dispatch) {
        const promise = postApi(`project/${projectId}/upgradeToEnterprise`, {
            projectName,
            oldPlan,
        });

        dispatch(changePlanRequest());

        promise
            .then(
                function(project) {
                    dispatch(changePlanSuccess(project));
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
                    dispatch(changePlanError(error));
                }
            )
            .then(function() {
                dispatch(changePlanReset());
            });

        return promise;
    };
}

// Calls the API to delete team member.

export function exitProjectRequest() {
    return {
        type: types.EXIT_PROJECT_REQUEST,
    };
}

export function exitProjectSuccess(userId) {
    return {
        type: types.EXIT_PROJECT_SUCCESS,
        payload: userId,
    };
}

export function exitProjectError(error) {
    return {
        type: types.EXIT_PROJECT_FAILED,
        payload: error,
    };
}

export function exitProject(projectId, userId) {
    return function(dispatch) {
        const promise = deleteApi(
            `project/${projectId}/user/${userId}/exitProject`,
            null
        );
        dispatch(exitProjectRequest());

        promise.then(
            function() {
                dispatch(exitProjectSuccess({ projectId, userId }));
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
                dispatch(exitProjectError(errors(error)));
            }
        );

        return promise;
    };
}

export function changeProjectRoles(team) {
    return {
        type: types.CHANGE_PROJECT_ROLES,
        payload: team,
    };
}

// Calls API to mark project for removal
export function markProjectForDeleteRequest() {
    return {
        type: types.MARK_PROJECT_DELETE_REQUEST,
    };
}

export function markProjectForDeleteSuccess(projectId) {
    return {
        type: types.MARK_PROJECT_DELETE_SUCCESS,
        payload: projectId,
    };
}

export function markProjectForDeleteError(error) {
    return {
        type: types.MARK_PROJECT_DELETE_FAILED,
        payload: error,
    };
}

export function markProjectForDelete(projectId, feedback) {
    return function(dispatch) {
        const promise = deleteApi(`project/${projectId}/deleteProject`, {
            projectId,
            feedback,
        });

        dispatch(markProjectForDeleteRequest());

        promise.then(
            function() {
                dispatch(markProjectForDeleteSuccess(projectId));
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
                dispatch(markProjectForDeleteError(errors(error)));
            }
        );

        return promise;
    };
}

export function alertOptionsUpdateRequest() {
    return {
        type: types.ALERT_OPTIONS_UPDATE_REQUEST,
    };
}

export function alertOptionsUpdateSuccess(project) {
    return {
        type: types.ALERT_OPTIONS_UPDATE_SUCCESS,
        payload: project.data,
    };
}

export function alertOptionsUpdateError(error) {
    return {
        type: types.ALERT_OPTIONS_UPDATE_FAILED,
        payload: error,
    };
}

export function alertOptionsUpdate(projectId, alertData) {
    return function(dispatch) {
        const promise = putApi(`project/${projectId}/alertOptions`, alertData);

        dispatch(alertOptionsUpdateRequest());

        promise.then(
            function(project) {
                dispatch(alertOptionsUpdateSuccess(project));
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
                dispatch(alertOptionsUpdateError(errors(error)));
            }
        );
        return promise;
    };
}

export function addBalanceRequest() {
    return {
        type: types.ADD_BALANCE_REQUEST,
    };
}

export function addBalanceSuccess(pi) {
    return {
        type: types.ADD_BALANCE_SUCCESS,
        payload: pi.data,
    };
}

export function addBalanceError(error) {
    return {
        type: types.ADD_BALANCE_FAILED,
        payload: error,
    };
}

export function addBalance(projectId, data) {
    return function(dispatch) {
        const promise = postApi(`stripe/${projectId}/addBalance`, data);

        dispatch(addBalanceRequest());

        promise.then(
            function(pi) {
                dispatch(addBalanceSuccess(pi));
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
                dispatch(addBalanceError(errors(error)));
            }
        );
        return promise;
    };
}

export function updateProjectBalanceRequest() {
    return {
        type: types.UPDATE_PROJECT_BALANCE_REQUEST,
    };
}

export function updateProjectBalanceSuccess(payload) {
    return {
        type: types.UPDATE_PROJECT_BALANCE_SUCCESS,
        payload,
    };
}

export function updateProjectBalanceFailure(error) {
    return {
        type: types.UPDATE_PROJECT_BALANCE_FAILURE,
        payload: error,
    };
}

export const updateProjectBalance = ({
    projectId,
    intentId,
}) => async dispatch => {
    dispatch(updateProjectBalanceRequest());

    try {
        const response = await getApi(
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

export function checkCardRequest(promise) {
    return {
        type: types.CHECK_CARD_REQUEST,
        payload: promise,
    };
}

export function checkCardFailed(error) {
    return {
        type: types.CHECK_CARD_FAILED,
        payload: error,
    };
}

export function checkCardSuccess(card) {
    return {
        type: types.CHECK_CARD_SUCCESS,
        payload: card,
    };
}

export function checkCard(data) {
    return function(dispatch) {
        const promise = postApi('stripe/checkCard', data);

        dispatch(checkCardRequest(promise));

        promise.then(
            function(card) {
                dispatch(checkCardSuccess(card.data));
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
                dispatch(checkCardFailed(error));
            }
        );
        return promise;
    };
}

export function setEmailIncidentNotificationRequest() {
    return {
        type: types.SET_EMAIL_INCIDENT_NOTIFICATION_REQUEST,
    };
}

export function setEmailIncidentNotificationSuccess(payload) {
    return {
        type: types.SET_EMAIL_INCIDENT_NOTIFICATION_SUCCESS,
        payload,
    };
}

export function setEmailIncidentNotificationFailure(error) {
    return {
        type: types.SET_EMAIL_INCIDENT_NOTIFICATION_FAILURE,
        payload: error,
    };
}

export function setEmailIncidentNotification({ projectId, data }) {
    return async function(dispatch) {
        dispatch(setEmailIncidentNotificationRequest());

        try {
            const response = await putApi(
                `project/${projectId}/advancedOptions/email`,
                data
            );
            dispatch(setEmailIncidentNotificationSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(setEmailIncidentNotificationFailure(errorMsg));
        }
    };
}

export function setSmsIncidentNotificationRequest() {
    return {
        type: types.SET_SMS_INCIDENT_NOTIFICATION_REQUEST,
    };
}

export function setSmsIncidentNotificationSuccess(payload) {
    return {
        type: types.SET_SMS_INCIDENT_NOTIFICATION_SUCCESS,
        payload,
    };
}

export function setSmsIncidentNotificationFailure(error) {
    return {
        type: types.SET_SMS_INCIDENT_NOTIFICATION_FAILURE,
        payload: error,
    };
}

export function setSmsIncidentNotification({ projectId, data }) {
    return async function(dispatch) {
        dispatch(setSmsIncidentNotificationRequest());

        try {
            const response = await putApi(
                `project/${projectId}/advancedOptions/sms`,
                data
            );
            dispatch(setSmsIncidentNotificationSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(setSmsIncidentNotificationFailure(errorMsg));
        }
    };
}

/* for webhook notification settings */
export function setWebhookNotificationSettingsRequest() {
    return {
        type: types.SET_WEBHOOK_NOTIFICATION_SETTINGS_REQUEST,
    };
}

export function setWebhookNotificationSettingsSuccess(payload) {
    return {
        type: types.SET_WEBHOOK_NOTIFICATION_SETTINGS_SUCCESS,
        payload,
    };
}

export function setWebhookNotificationSettingsFailure(error) {
    return {
        type: types.SET_WEBHOOK_NOTIFICATION_SETTINGS_FAILURE,
        payload: error,
    };
}

export function setWebhookNotificationSettings({ projectId, data }) {
    return async function(dispatch) {
        dispatch(setWebhookNotificationSettingsRequest());

        try {
            const response = await putApi(
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
}
