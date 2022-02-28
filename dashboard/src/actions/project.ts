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
import {
    getSubProjects,
    resetSubProjects,
    setActiveSubProject,
} from './subProject';
import { resetFetchComponentResources } from './component';
import errors from '../errors';
import isMainProjectViewer from '../utils/isMainProjectViewer';
import { socket } from '../components/basic/Socket';

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

export function projectsRequest(promise: $TSFixMe) {
    return {
        type: types.PROJECTS_REQUEST,
        payload: promise,
    };
}

export function projectsError(error: $TSFixMe) {
    return {
        type: types.PROJECTS_FAILED,
        payload: error,
    };
}

export function projectsSuccess(projects: $TSFixMe) {
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

export function getProjects(switchToProjectId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = getApi(
            `project/projects?skip=${0}&limit=${9999}`,

            null
        );
        dispatch(projectsRequest(promise));

        promise.then(
            function(projects) {
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
export function getprojectError(error: $TSFixMe) {
    return {
        type: types.GET_PROJECT_BALANCE_FAILED,
        payload: error,
    };
}
export function getProjectBalanceSuccess(project: $TSFixMe) {
    return {
        type: types.GET_PROJECT_BALANCE_SUCCESS,
        payload: project,
    };
}

export function getProjectBalance(projectId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
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

export function createProjectError(error: $TSFixMe) {
    return {
        type: types.CREATE_PROJECT_FAILED,
        payload: error,
    };
}

export function createProjectSuccess(project: $TSFixMe) {
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

export function createProject(values: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
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

export function switchToProjectViewerNav(
    userId: $TSFixMe,
    subProjects: $TSFixMe,
    currentProject: $TSFixMe
) {
    return function(dispatch: $TSFixMe) {
        dispatch({
            type: types.SHOW_VIEWER_MENU,
            payload: isMainProjectViewer(userId, subProjects, currentProject),
        });
    };
}

export function switchProject(
    dispatch: $TSFixMe,
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
        !User.getActiveSubProjectId('active_subproject_id') &&
        switchToMainProject
    ) {
        dispatch(setActiveSubProject(project._id, true));
    }

    const activeSubProjectId = User.getActiveSubProjectId(
        'active_subproject_id'
    );

    // emit project id to connect to room in backend
    socket?.emit('project_switch', activeSubProjectId);

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
    dispatch(setActiveSubProject(activeSubProjectId));

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
    fetchAlert(activeSubProjectId)(dispatch);

    fetchSubProjectStatusPages(activeSubProjectId)(dispatch);
    fetchComponents({ projectId: activeSubProjectId })(dispatch); // default skip = 0, limit = 3
    fetchMonitors(activeSubProjectId)(dispatch);

    fetchResourceCategories(project._id)(dispatch);
    fetchResourceCategoriesForNewResource(project._id)(dispatch);
    fetchUnresolvedIncidents(project._id, true)(dispatch);

    fetchSchedules(activeSubProjectId)(dispatch);
    fetchSubProjectSchedules(activeSubProjectId)(dispatch);
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

export function resetProjectTokenSuccess(project: $TSFixMe) {
    return {
        type: types.RESET_PROJECT_TOKEN_SUCCESS,
        payload: project.data,
    };
}

export function resetProjectTokenError(error: $TSFixMe) {
    return {
        type: types.RESET_PROJECT_TOKEN_FAILED,
        payload: error,
    };
}

export function resetProjectToken(projectId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
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

export function renameProjectSuccess(project: $TSFixMe) {
    return {
        type: types.RENAME_PROJECT_SUCCESS,
        payload: project.data,
    };
}

export function renameProjectError(error: $TSFixMe) {
    return {
        type: types.RENAME_PROJECT_FAILED,
        payload: error,
    };
}

export function renameProject(projectId: $TSFixMe, projectName: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
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

export function deleteProjectSuccess(projectId: $TSFixMe) {
    return {
        type: types.DELETE_PROJECT_SUCCESS,
        payload: projectId,
    };
}

export function deleteProjectError(error: $TSFixMe) {
    return {
        type: types.DELETE_PROJECT_FAILED,
        payload: error,
    };
}

export function deleteProject(projectId: $TSFixMe, feedback: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
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

export function changePlanSuccess(project: $TSFixMe) {
    return {
        type: types.CHANGE_PLAN_SUCCESS,
        payload: project.data,
    };
}

export function changePlanError(error: $TSFixMe) {
    return {
        type: types.CHANGE_PLAN_FAILED,
        payload: error,
    };
}

export function changePlan(
    projectId: $TSFixMe,
    planId: $TSFixMe,
    projectName: $TSFixMe,
    oldPlan: $TSFixMe,
    newPlan: $TSFixMe
) {
    return function(dispatch: $TSFixMe) {
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

export function upgradeToEnterpriseMail(
    projectId: $TSFixMe,
    projectName: $TSFixMe,
    oldPlan: $TSFixMe
) {
    return function(dispatch: $TSFixMe) {
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

export function exitProjectSuccess(userId: $TSFixMe) {
    return {
        type: types.EXIT_PROJECT_SUCCESS,
        payload: userId,
    };
}

export function exitProjectError(error: $TSFixMe) {
    return {
        type: types.EXIT_PROJECT_FAILED,
        payload: error,
    };
}

export function exitProject(projectId: $TSFixMe, userId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
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

export function changeProjectRoles(team: $TSFixMe) {
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

export function markProjectForDeleteSuccess(projectId: $TSFixMe) {
    return {
        type: types.MARK_PROJECT_DELETE_SUCCESS,
        payload: projectId,
    };
}

export function markProjectForDeleteError(error: $TSFixMe) {
    return {
        type: types.MARK_PROJECT_DELETE_FAILED,
        payload: error,
    };
}

export function markProjectForDelete(projectId: $TSFixMe, feedback: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
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

export function alertOptionsUpdateSuccess(project: $TSFixMe) {
    return {
        type: types.ALERT_OPTIONS_UPDATE_SUCCESS,
        payload: project.data,
    };
}

export function alertOptionsUpdateError(error: $TSFixMe) {
    return {
        type: types.ALERT_OPTIONS_UPDATE_FAILED,
        payload: error,
    };
}

export function alertOptionsUpdate(projectId: $TSFixMe, alertData: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
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

export function addBalanceSuccess(pi: $TSFixMe) {
    return {
        type: types.ADD_BALANCE_SUCCESS,
        payload: pi.data,
    };
}

export function addBalanceError(error: $TSFixMe) {
    return {
        type: types.ADD_BALANCE_FAILED,
        payload: error,
    };
}

export function addBalance(projectId: $TSFixMe, data: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
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

export function updateProjectBalanceSuccess(payload: $TSFixMe) {
    return {
        type: types.UPDATE_PROJECT_BALANCE_SUCCESS,
        payload,
    };
}

export function updateProjectBalanceFailure(error: $TSFixMe) {
    return {
        type: types.UPDATE_PROJECT_BALANCE_FAILURE,
        payload: error,
    };
}

export const updateProjectBalance = ({
    projectId,
    intentId,
}: $TSFixMe) => async (dispatch: $TSFixMe) => {
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

export function checkCardRequest(promise: $TSFixMe) {
    return {
        type: types.CHECK_CARD_REQUEST,
        payload: promise,
    };
}

export function checkCardFailed(error: $TSFixMe) {
    return {
        type: types.CHECK_CARD_FAILED,
        payload: error,
    };
}

export function checkCardSuccess(card: $TSFixMe) {
    return {
        type: types.CHECK_CARD_SUCCESS,
        payload: card,
    };
}

export function checkCard(data: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
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

export function setEmailNotificationRequest() {
    return {
        type: types.SET_EMAIL_INCIDENT_NOTIFICATION_REQUEST,
    };
}

export function setEmailNotificationSuccess(payload: $TSFixMe) {
    return {
        type: types.SET_EMAIL_INCIDENT_NOTIFICATION_SUCCESS,
        payload,
    };
}

export function setEmailNotificationFailure(error: $TSFixMe) {
    return {
        type: types.SET_EMAIL_INCIDENT_NOTIFICATION_FAILURE,
        payload: error,
    };
}

export function setEmailNotification({ projectId, data }: $TSFixMe) {
    return async function(dispatch: $TSFixMe) {
        dispatch(setEmailNotificationRequest());

        try {
            const response = await putApi(
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
}

export function setSmsNotificationRequest() {
    return {
        type: types.SET_SMS_INCIDENT_NOTIFICATION_REQUEST,
    };
}

export function setSmsNotificationSuccess(payload: $TSFixMe) {
    return {
        type: types.SET_SMS_INCIDENT_NOTIFICATION_SUCCESS,
        payload,
    };
}

export function setSmsNotificationFailure(error: $TSFixMe) {
    return {
        type: types.SET_SMS_INCIDENT_NOTIFICATION_FAILURE,
        payload: error,
    };
}

export function setSmsNotification({ projectId, data }: $TSFixMe) {
    return async function(dispatch: $TSFixMe) {
        dispatch(setSmsNotificationRequest());

        try {
            const response = await putApi(
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
}

/* for webhook notification settings */
export function setWebhookNotificationSettingsRequest() {
    return {
        type: types.SET_WEBHOOK_NOTIFICATION_SETTINGS_REQUEST,
    };
}

export function setWebhookNotificationSettingsSuccess(payload: $TSFixMe) {
    return {
        type: types.SET_WEBHOOK_NOTIFICATION_SETTINGS_SUCCESS,
        payload,
    };
}

export function setWebhookNotificationSettingsFailure(error: $TSFixMe) {
    return {
        type: types.SET_WEBHOOK_NOTIFICATION_SETTINGS_FAILURE,
        payload: error,
    };
}

export function setWebhookNotificationSettings({ projectId, data }: $TSFixMe) {
    return async function(dispatch: $TSFixMe) {
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

/* for project wide domains */
export function createProjectDomainRequest() {
    return {
        type: types.CREATE_PROJECT_DOMAIN_REQUEST,
    };
}

export function createProjectDomainSuccess(payload: $TSFixMe) {
    return {
        type: types.CREATE_PROJECT_DOMAIN_SUCCESS,
        payload,
    };
}

export function createProjectDomainFailure(error: $TSFixMe) {
    return {
        type: types.CREATE_PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
}

export function resetCreateProjectDomain() {
    return {
        type: types.RESET_CREATE_PROJECT_DOMAIN,
    };
}

export function createProjectDomain({ projectId, data }: $TSFixMe) {
    return async function(dispatch: $TSFixMe) {
        dispatch(createProjectDomainRequest());

        try {
            const response = await postApi(
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
}

export function fetchProjectDomainsRequest() {
    return {
        type: types.FETCH_PROJECT_DOMAINS_REQUEST,
    };
}

export function fetchProjectDomainsSuccess(payload: $TSFixMe) {
    return {
        type: types.FETCH_PROJECT_DOMAINS_SUCCESS,
        payload,
    };
}

export function fetchProjectDomainsFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_PROJECT_DOMAINS_FAILURE,
        payload: error,
    };
}

export function fetchProjectDomains(projectId: $TSFixMe, skip = 0, limit = 10) {
    return async function(dispatch: $TSFixMe) {
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

export function updateProjectDomainRequest() {
    return {
        type: types.UPDATE_PROJECT_DOMAIN_REQUEST,
    };
}

export function updateProjectDomainSuccess(payload: $TSFixMe) {
    return {
        type: types.UPDATE_PROJECT_DOMAIN_SUCCESS,
        payload,
    };
}

export function updateProjectDomainFailure(error: $TSFixMe) {
    return {
        type: types.UPDATE_PROJECT_DOMAIN_FAILURE,
        payload: error,
    };
}

export function resetUpdateProjectDomain() {
    return {
        type: types.RESET_UPDATE_PROJECT_DOMAIN,
    };
}

export function updateProjectDomain({ projectId, domainId, data }: $TSFixMe) {
    return async function(dispatch: $TSFixMe) {
        dispatch(updateProjectDomainRequest());

        try {
            const response = await putApi(
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

export function verifyProjectDomain({ projectId, domainId, data }: $TSFixMe) {
    return async function(dispatch: $TSFixMe) {
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

export function fetchTrialReset() {
    return {
        type: types.RESET_FETCH_TRIAL,
    };
}

export function fetchTrialRequest() {
    return {
        type: types.FETCH_TRIAL_REQUEST,
    };
}

export function fetchTrialSuccess(response: $TSFixMe) {
    return {
        type: types.FETCH_TRIAL_SUCCESS,
        payload: response.data,
    };
}

export function fetchTrialError(error: $TSFixMe) {
    return {
        type: types.FETCH_TRIAL_FAILURE,
        payload: error,
    };
}

export function fetchTrial(projectId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = postApi(`stripe/${projectId}/getTrial`);

        dispatch(fetchTrialRequest());

        promise.then(
            function(response) {
                dispatch(fetchTrialSuccess(response));
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
                dispatch(fetchTrialError(errors(error)));
            }
        );

        return promise;
    };
}

export function fetchProjectSlugRequest() {
    return {
        type: types.FETCH_PROJECT_SLUG_REQUEST,
    };
}

export function fetchProjectSlugSuccess(payload: $TSFixMe) {
    return {
        type: types.FETCH_PROJECT_SLUG_SUCCESS,
        payload,
    };
}

export function fetchProjectSlugFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_PROJECT_SLUG_FAILURE,
        payload: error,
    };
}

export function fetchProjectSlug(slug: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = getApi(`project/project-slug/${slug}`);

        dispatch(fetchProjectSlugRequest());

        promise.then(
            function(response) {
                dispatch(fetchProjectSlugSuccess(response.data));
            },
            function(error) {
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
}
