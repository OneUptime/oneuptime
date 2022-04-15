import * as types from '../constants/project';

import Action from 'CommonUI/src/types/action';

const initialState: $TSFixMe = {
    projects: {
        requesting: false,
        error: null,
        success: false,
        projects: [],
    },
    currentProject: null,
    newProject: {
        requesting: false,
        error: null,
        success: false,
        project: {},
    },
    projectSlug: {
        requesting: false,
        error: null,
        success: false,
        project: null,
    },
    projectSwitcherVisible: false,
    resetToken: {
        success: false,
        requesting: false,
        error: null,
    },
    renameProject: {
        success: false,
        requesting: false,
        error: null,
    },
    addBalance: {
        success: false,
        requesting: false,
        error: null,
        pi: {},
    },
    checkCard: {
        success: false,
        requesting: false,
        error: null,
        pi: {},
    },
    alertOptionsUpdate: {
        success: false,
        requesting: false,
        error: null,
        project: {},
    },
    changePlan: {
        success: false,
        requesting: false,
        error: null,
    },
    deleteProject: {
        success: false,
        requesting: false,
        error: null,
    },
    exitProject: {
        success: false,
        requesting: false,
        error: null,
    },
    getProjectBalance: {
        success: false,
        requesting: false,
        error: null,
    },
    showForm: false,
    showUpgradeForm: false,
    canUpgrade: true, // Used to check if the user has plans they can upgrade to.
    showDeleteModal: false,
    deletedModal: false,
    emailIncidentNotification: {
        requesting: false,
        success: false,
        error: null,
    },
    smsIncidentNotification: {
        requesting: false,
        success: false,
        error: null,
    },
    webhookNotificationSettings: {
        requesting: false,
        success: false,
        error: null,
    },
    switchToProjectViewerNav: false,
    fetchDomains: {
        requesting: false,
        success: false,
        error: null,
        domains: [],
        skip: 0,
        limit: 10,
        count: 0,
    },
    createDomain: {
        requesting: false,
        success: false,
        error: null,
    },
    updateDomain: {
        requesting: false,
        success: false,
        error: null,
    },
    deleteDomain: {
        requesting: false,
        success: false,
        error: null,
    },
    verifyDomain: {
        requesting: false,
        success: false,
        error: null,
    },
    trialPeriod: {
        success: false,
        requesting: false,
        error: null,
    },
};

export default function project(state: $TSFixMe = initialState, action: Action): void {
    let projects: $TSFixMe, newProjects: $TSFixMe;
    switch (action.type) {
        case types.CHANGE_DELETE_MODAL:
            return Object.assign({}, state, {
                deletedModal: true,
            });
        case types.PROJECTS_SUCCESS:
            return Object.assign({}, state, {
                projects: {
                    requesting: false,
                    error: null,
                    success: true,
                    projects: action.payload,
                },
            });

        case types.PROJECTS_REQUEST:
            return Object.assign({}, state, {
                projects: {
                    ...state.projects,
                    requesting: true,
                    success: false,
                    error: null,
                },
            });

        case types.PROJECTS_FAILED:
            return Object.assign({}, state, {
                projects: {
                    ...state.projects,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case types.PROJECTS_RESET:
            return Object.assign({}, state, {
                projects: {
                    requesting: false,
                    error: null,
                    success: false,
                    projects: [],
                },
            });

        case types.SWITCH_PROJECT:
            return Object.assign({}, state, {
                currentProject: action.payload,
            });

        case types.SWITCH_PROJECT_RESET:
            return Object.assign({}, state, {
                currentProject: null,
            });

        case types.CREATE_PROJECT_RESET:
            return Object.assign({}, state, {
                currentProject: null,
            });

        case types.CREATE_PROJECT_SUCCESS:
            newProjects = Object.assign([], state.projects.projects);

            newProjects.push(action.payload);
            return Object.assign({}, state, {
                newProject: {
                    requesting: false,
                    error: null,
                    success: true,
                    project: action.payload,
                },
                currentProject: action.payload,
                projects: {
                    requesting: false,
                    error: null,
                    success: true,
                    projects: newProjects,
                },
            });

        case types.CREATE_PROJECT_REQUEST:
            return Object.assign({}, state, {
                newProject: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });

        case types.CREATE_PROJECT_FAILED:
            return Object.assign({}, state, {
                newProject: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case types.RESET_PROJECT_TOKEN_SUCCESS:
            projects = Object.assign([], state.projects.projects);
            projects = projects.filter((project: $TSFixMe) => {
                return project._id !== action.payload._id;
            });

            projects.push(action.payload);
            return Object.assign({}, state, {
                projects: {
                    requesting: false,
                    error: null,
                    success: true,
                    projects,
                },
                currentProject: action.payload,
                resetToken: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            });

        case types.RESET_PROJECT_TOKEN_REQUEST:
            return Object.assign({}, state, {
                resetToken: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });

        case types.RESET_PROJECT_TOKEN_FAILED:
            return Object.assign({}, state, {
                resetToken: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case types.RESET_PROJECT_TOKEN_RESET:
            return Object.assign({}, state, {
                resetToken: {
                    requesting: false,
                    success: false,
                    error: null,
                },
            });

        case types.RENAME_PROJECT_SUCCESS:
            projects = Object.assign([], state.projects.projects);
            projects = projects.filter((project: $TSFixMe) => {
                return project._id !== action.payload._id;
            });

            projects.push(action.payload);
            return Object.assign({}, state, {
                projects: {
                    requesting: false,
                    error: null,
                    success: true,
                    projects,
                },
                currentProject: action.payload,
                renameProject: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            });

        case types.RENAME_PROJECT_RESET:
            return Object.assign({}, state, {
                renameProject: {
                    requesting: false,
                    success: false,
                    error: null,
                },
            });

        case types.RENAME_PROJECT_REQUEST:
            return Object.assign({}, state, {
                renameProject: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });

        case types.RENAME_PROJECT_FAILED:
            return Object.assign({}, state, {
                renameProject: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });
        case types.GET_PROJECT_BALANCE_REQUEST:
            return Object.assign({}, state, {
                getProjectBalance: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });
        case types.GET_PROJECT_BALANCE_FAILED:
            return Object.assign({}, state, {
                getProjectBalance: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });
        case types.GET_PROJECT_BALANCE_SUCCESS:
            return Object.assign({}, state, {
                currentProject: {
                    ...state.currentProject,
                    balance: action.payload.balance,
                },
                getProjectBalance: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            });
        case types.DELETE_PROJECT_SUCCESS:
            projects = Object.assign([], state.projects.projects);
            projects = projects.filter((project: $TSFixMe) => {
                return project._id !== action.payload;
            });
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: false,
                    deleted: true,
                    success: action.payload.ok === 1,
                    error: null,
                },
                projects: {
                    requesting: false,
                    error: null,
                    success: true,
                    projects,
                },
            });

        case types.DELETE_PROJECT_REQUEST:
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });

        case types.DELETE_PROJECT_FAILED:
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case types.DELETE_PROJECT_RESET:
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: false,
                    success: false,
                    error: null,
                },
            });

        case types.MARK_PROJECT_DELETE_SUCCESS:
            projects = Object.assign([], state.projects.projects);
            projects = projects.filter((project: $TSFixMe) => {
                return project._id !== action.payload;
            });
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: false,
                    success: action.payload.ok === 1,
                    error: null,
                },
                projects: {
                    requesting: false,
                    error: null,
                    success: true,
                    projects,
                },
            });

        case types.MARK_PROJECT_DELETE_REQUEST:
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });

        case types.MARK_PROJECT_DELETE_FAILED:
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case types.MARK_PROJECT_DELETE_RESET:
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: false,
                    success: false,
                    error: null,
                },
            });

        case types.SHOW_PROJECT_SWITCHER:
            return Object.assign({}, state, {
                projectSwitcherVisible: true,
            });

        case types.HIDE_PROJECT_SWITCHER:
            return Object.assign({}, state, {
                projectSwitcherVisible: false,
            });

        case types.SHOW_PROJECT_FORM:
            return Object.assign({}, state, {
                showForm: true,
            });

        case types.HIDE_PROJECT_FORM:
            return Object.assign({}, state, {
                showForm: false,
            });

        case types.SHOW_UPGRADE_FORM:
            return Object.assign({}, state, {
                showUpgradeForm: true,
            });

        case types.HIDE_UPGRADE_FORM:
            return Object.assign({}, state, {
                showUpgradeForm: false,
            });

        case types.SHOW_DELETE_MODAL:
            return Object.assign({}, state, {
                showDeleteModal: true,
            });

        case types.HIDE_DELETE_MODAL:
            return Object.assign({}, state, {
                showDeleteModal: false,
                deletedModal: false,
            });
        case types.HIDE_DELETE_MODAL_SAAS_MODE:
            return Object.assign({}, state, {
                showDeleteModal: false,
                deletedModal: false,
                deleteProject: {
                    ...state.deleteProject,
                    deleted: false,
                },
            });

        case types.CHANGE_PLAN_SUCCESS:
            projects = Object.assign([], state.projects.projects);
            projects = projects.filter((project: $TSFixMe) => {
                return project._id !== action.payload._id;
            });

            projects.push(action.payload);
            return Object.assign({}, state, {
                projects: {
                    requesting: false,
                    error: null,
                    success: true,
                    projects,
                },
                currentProject: action.payload,
                changePlan: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            });

        case types.CHANGE_PLAN_RESET:
            return Object.assign({}, state, {
                changePlan: {
                    requesting: false,
                    success: false,
                    error: null,
                },
            });

        case types.CHANGE_PLAN_REQUEST:
            return Object.assign({}, state, {
                changePlan: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });

        case types.CHANGE_PLAN_FAILED:
            return Object.assign({}, state, {
                changePlan: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case types.UPGRADE_PLAN_EMPTY:
            return Object.assign({}, state, {
                canUpgrade: false,
            });

        case types.EXIT_PROJECT_SUCCESS:
            return Object.assign({}, state, {
                exitProject: {
                    requesting: false,
                    error: null,
                    success: true,
                },
                currentProject: null,
            });

        case types.EXIT_PROJECT_REQUEST:
            return Object.assign({}, state, {
                exitProject: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });

        case types.EXIT_PROJECT_FAILED:
            return Object.assign({}, state, {
                exitProject: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case types.CHANGE_PROJECT_ROLES:
            return Object.assign({}, state, {
                currentProject: {
                    ...state.currentProject,
                    users: action.payload.find((team: $TSFixMe) => {
                        return team.projectId === state.currentProject._id;
                    }).team,
                },
            });
        case types.ALERT_OPTIONS_UPDATE_SUCCESS:
            return Object.assign({}, state, {
                alertOptionsUpdate: {
                    success: true,
                    requesting: false,
                    error: null,
                    project: action.payload,
                },
                currentProject: {
                    ...state.currentProject,
                    alertEnable: action.payload.alertEnable,
                    alertOptions: action.payload.alertOptions,
                    balance: action.payload.balance,
                },
            });

        case types.ALERT_OPTIONS_UPDATE_REQUEST:
            return Object.assign({}, state, {
                alertOptionsUpdate: {
                    ...state.alertOptionsUpdate,
                    success: false,
                    requesting: true,
                    error: null,
                },
            });
        case types.ALERT_OPTIONS_UPDATE_FAILED:
            return Object.assign({}, state, {
                alertOptionsUpdate: {
                    ...state.alertOptionsUpdate,
                    success: false,
                    requesting: false,
                    error: action.payload,
                },
            });

        case types.ADD_BALANCE_SUCCESS:
            return Object.assign({}, state, {
                addBalance: {
                    success: true,
                    requesting: false,
                    error: null,
                    pi: action.payload,
                },
            });

        case types.ADD_BALANCE_REQUEST:
            return Object.assign({}, state, {
                addBalance: {
                    ...state.addBalance,
                    requesting: true,
                },
            });
        case types.ADD_BALANCE_FAILED:
            return Object.assign({}, state, {
                addBalance: {
                    pi: {},
                    success: false,
                    requesting: false,
                    error: action.payload,
                },
            });
        case types.CHECK_CARD_REQUEST:
            return Object.assign({}, state, {
                ...state,
                checkCard: {
                    ...state.checkCard,
                    requesting: true,
                },
            });

        case types.CHECK_CARD_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                checkCard: {
                    requesting: false,
                    error: null,
                    success: true,
                    pi: action.payload,
                },
            });

        case types.CHECK_CARD_FAILED:
            return Object.assign({}, state, {
                ...state,
                checkCard: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case types.SET_EMAIL_INCIDENT_NOTIFICATION_REQUEST:
            return {
                ...state,
                emailIncidentNotification: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.SET_EMAIL_INCIDENT_NOTIFICATION_SUCCESS:
            return {
                ...state,
                emailIncidentNotification: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                currentProject: action.payload,
            };

        case types.SET_EMAIL_INCIDENT_NOTIFICATION_FAILURE:
            return {
                ...state,
                emailIncidentNotification: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.SET_SMS_INCIDENT_NOTIFICATION_REQUEST:
            return {
                ...state,
                smsIncidentNotification: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.SET_SMS_INCIDENT_NOTIFICATION_SUCCESS:
            return {
                ...state,
                smsIncidentNotification: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                currentProject: action.payload,
            };

        case types.SET_SMS_INCIDENT_NOTIFICATION_FAILURE:
            return {
                ...state,
                smsIncidentNotification: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case types.SET_WEBHOOK_NOTIFICATION_SETTINGS_REQUEST:
            return {
                ...state,
                webhookNotificationSettings: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.SET_WEBHOOK_NOTIFICATION_SETTINGS_SUCCESS:
            return {
                ...state,
                webhookNotificationSettings: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                currentProject: action.payload,
            };

        case types.SET_WEBHOOK_NOTIFICATION_SETTINGS_FAILURE:
            return {
                ...state,
                webhookNotificationSettings: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.SHOW_VIEWER_MENU:
            return Object.assign({}, state, {
                switchToProjectViewerNav: action.payload,
            });

        case types.CREATE_PROJECT_DOMAIN_REQUEST:
            return {
                ...state,
                createDomain: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.CREATE_PROJECT_DOMAIN_SUCCESS:
            return {
                ...state,
                createDomain: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            };

        case types.CREATE_PROJECT_DOMAIN_FAILURE:
            return {
                ...state,
                createDomain: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.RESET_CREATE_PROJECT_DOMAIN:
            return {
                ...state,
                createDomain: {
                    requesting: false,
                    success: false,
                    error: null,
                },
            };

        case types.UPDATE_PROJECT_DOMAIN_REQUEST:
            return {
                ...state,
                updateDomain: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.UPDATE_PROJECT_DOMAIN_SUCCESS:
            return {
                ...state,
                updateDomain: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            };

        case types.UPDATE_PROJECT_DOMAIN_FAILURE:
            return {
                ...state,
                updateDomain: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.RESET_UPDATE_PROJECT_DOMAIN:
            return {
                ...state,
                updateDomain: {
                    requesting: false,
                    success: false,
                    error: null,
                },
            };

        case types.FETCH_PROJECT_DOMAINS_REQUEST:
            return {
                ...state,
                fetchDomains: {
                    ...state.fetchDomains,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.FETCH_PROJECT_DOMAINS_SUCCESS:
            return {
                ...state,
                fetchDomains: {
                    requesting: false,
                    success: true,
                    error: null,
                    count: action.payload.count,
                    skip: action.payload.skip,
                    limit: action.payload.limit,
                    domains: action.payload.data,
                },
            };

        case types.FETCH_PROJECT_DOMAINS_FAILURE:
            return {
                ...state,
                fetchDomains: {
                    ...state.fetchDomains,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.DELETE_PROJECT_DOMAIN_REQUEST:
            return {
                ...state,
                deleteDomain: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.DELETE_PROJECT_DOMAIN_FAILURE:
            return {
                ...state,
                deleteDomain: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.DELETE_PROJECT_DOMAIN_SUCCESS:
            return {
                ...state,
                deleteDomain: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            };

        case types.RESET_DELETE_PROJECT_DOMAIN:
            return {
                ...state,
                deleteDomain: {
                    requesting: false,
                    success: false,
                    error: null,
                },
            };

        case types.VERIFY_PROJECT_DOMAIN_REQUEST:
            return {
                ...state,
                verifyDomain: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.VERIFY_PROJECT_DOMAIN_SUCCESS:
            return {
                ...state,
                verifyDomain: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            };

        case types.VERIFY_PROJECT_DOMAIN_FAILURE:
            return {
                ...state,
                verifyDomain: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.RESET_VERIFY_PROJECT_DOMAIN:
            return {
                ...state,
                verifyDomain: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.FETCH_TRIAL_REQUEST:
            return {
                ...state,
                trialPeriod: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.FETCH_TRIAL_SUCCESS:
            return {
                ...state,
                trialPeriod: {
                    requesting: false,
                    success: true,
                    error: null,
                    trial_end: action.payload,
                },
            };

        case types.FETCH_TRIAL_FAILURE:
            return {
                ...state,
                trialPeriod: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.RESET_FETCH_TRIAL:
            return {
                ...state,
                trialPeriod: {
                    requesting: false,
                    success: false,
                    error: null,
                },
            };

        case types.FETCH_PROJECT_SLUG_REQUEST:
            return {
                ...state,
                projectSlug: {
                    ...state.projectSlug,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.FETCH_PROJECT_SLUG_SUCCESS:
            return {
                ...state,
                projectSlug: {
                    requesting: false,
                    success: true,
                    error: null,
                    project: action.payload,
                },
            };

        case types.FETCH_PROJECT_SLUG_FAILURE:
            return {
                ...state,
                projectSlug: {
                    ...state.projectSlug,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        default:
            return state;
    }
}
