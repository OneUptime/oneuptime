import * as types from '../constants/project'

const initialState = {
    projects: {
        requesting: false,
        error: null,
        success: false,
        projects: []
    },
    currentProject: null,
    newProject: {
        requesting: false,
        error: null,
        success: false,
        project: {}
    },
    projectSwitcherVisible: false,
    resetToken: {
        success: false,
        requesting: false,
        error: null
    },
    renameProject: {
        success: false,
        requesting: false,
        error: null
    },
    addBalance: {
        success: false,
        requesting: false,
        error: null,
        pi: {}
    },
    checkCard: {
        success: false,
        requesting: false,
        error: null,
        pi: {}
    },
    alertOptionsUpdate: {
        success: false,
        requesting: false,
        error: null,
        project: {}
    },
    changePlan: {
        success: false,
        requesting: false,
        error: null
    },
    deleteProject: {
        success: false,
        requesting: false,
        error: null
    },
    exitProject: {
        success: false,
        requesting: false,
        error: null
    },
    showForm: false,
    showUpgradeForm: false,
    canUpgrade: true, // Used to check if the user has plans they can upgrade to.
    showDeleteModal: false
};

export default function project(state = initialState, action) {
    let projects, newProjects;
    switch (action.type) {

        case types.PROJECTS_SUCCESS:
            return Object.assign({}, state, {
                projects: {
                    requesting: false,
                    error: null,
                    success: true,
                    projects: action.payload
                },
            });

        case types.PROJECTS_REQUEST:
            return Object.assign({}, state, {
                projects: {
                    ...state.projects,
                    requesting: true,
                    success: false,
                    error: null
                }
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
                    projects: []
                },
            });

        case types.SWITCH_PROJECT:
            return Object.assign({}, state, {
                currentProject: action.payload
            });

        case types.SWITCH_PROJECT_RESET:
            return Object.assign({}, state, {
                currentProject: null
            });

        case types.CREATE_PROJECT_RESET:
            return Object.assign({}, state, {
                currentProject: null
            });

        case types.CREATE_PROJECT_SUCCESS:
            newProjects = Object.assign([], state.projects.projects);
            newProjects.push(action.payload);
            return Object.assign({}, state, {
                newProject: {
                    requesting: false,
                    error: null,
                    success: true,
                    project: action.payload
                },
                currentProject: action.payload,
                projects: {
                    requesting: false,
                    error: null,
                    success: true,
                    projects: newProjects
                }
            });

        case types.CREATE_PROJECT_REQUEST:
            return Object.assign({}, state, {
                newProject: {
                    requesting: true,
                    success: false,
                    error: null
                }
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
            projects = projects.filter(project => project._id !== action.payload._id);
            projects.push(action.payload);
            return Object.assign({}, state, {
                projects: {
                    requesting: false,
                    error: null,
                    success: true,
                    projects
                },
                currentProject: action.payload,
                resetToken: {
                    requesting: false,
                    success: true,
                    error: null
                }
            });

        case types.RESET_PROJECT_TOKEN_REQUEST:
            return Object.assign({}, state, {
                resetToken: {
                    requesting: true,
                    success: false,
                    error: null
                }
            });

        case types.RESET_PROJECT_TOKEN_FAILED:
            return Object.assign({}, state, {
                resetToken: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            });

        case types.RESET_PROJECT_TOKEN_RESET:
            return Object.assign({}, state, {
                resetToken: {
                    requesting: false,
                    success: false,
                    error: null,
                }
            });

        case types.RENAME_PROJECT_SUCCESS:
            projects = Object.assign([], state.projects.projects);
            projects = projects.filter(project => project._id !== action.payload._id);
            projects.push(action.payload);
            return Object.assign({}, state, {
                projects: {
                    requesting: false,
                    error: null,
                    success: true,
                    projects
                },
                currentProject: action.payload,
                renameProject: {
                    requesting: false,
                    success: true,
                    error: null
                }
            });

        case types.RENAME_PROJECT_RESET:
            return Object.assign({}, state, {
                renameProject: {
                    requesting: false,
                    success: false,
                    error: null
                }
            });

        case types.RENAME_PROJECT_REQUEST:
            return Object.assign({}, state, {
                renameProject: {
                    requesting: true,
                    success: false,
                    error: null
                }
            });

        case types.RENAME_PROJECT_FAILED:
            return Object.assign({}, state, {
                renameProject: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            });

        case types.DELETE_PROJECT_SUCCESS:
            projects = Object.assign([], state.projects.projects);
            projects = projects.filter(project => project._id !== action.payload);
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: false,
                    success: action.payload.ok === 1,
                    error: null
                },
                projects: {
                    requesting: false,
                    error: null,
                    success: true,
                    projects
                }
            });

        case types.DELETE_PROJECT_REQUEST:
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: true,
                    success: false,
                    error: null
                }
            });

        case types.DELETE_PROJECT_FAILED:
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            });

        case types.DELETE_PROJECT_RESET:
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: false,
                    success: false,
                    error: null,
                }
            });

        case types.MARK_PROJECT_DELETE_SUCCESS:
            projects = Object.assign([], state.projects.projects);
            projects = projects.filter(project => project._id !== action.payload);
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: false,
                    success: action.payload.ok === 1,
                    error: null
                },
                projects: {
                    requesting: false,
                    error: null,
                    success: true,
                    projects
                }
            });

        case types.MARK_PROJECT_DELETE_REQUEST:
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: true,
                    success: false,
                    error: null
                }
            });

        case types.MARK_PROJECT_DELETE_FAILED:
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            });

        case types.MARK_PROJECT_DELETE_RESET:
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: false,
                    success: false,
                    error: null,
                }
            });

        case types.SHOW_PROJECT_SWITCHER:
            return Object.assign({}, state, {
                projectSwitcherVisible: true
            });

        case types.HIDE_PROJECT_SWITCHER:
            return Object.assign({}, state, {
                projectSwitcherVisible: false
            });

        case types.SHOW_PROJECT_FORM:
            return Object.assign({}, state, {
                showForm: true
            });

        case types.HIDE_PROJECT_FORM:
            return Object.assign({}, state, {
                showForm: false
            });

        case types.SHOW_UPGRADE_FORM:
            return Object.assign({}, state, {
                showUpgradeForm: true
            });

        case types.HIDE_UPGRADE_FORM:
            return Object.assign({}, state, {
                showUpgradeForm: false
            });

        case types.SHOW_DELETE_MODAL:
            return Object.assign({}, state, {
                showDeleteModal: true
            });

        case types.HIDE_DELETE_MODAL:
            return Object.assign({}, state, {
                showDeleteModal: false
            });

        case types.CHANGE_PLAN_SUCCESS:
            projects = Object.assign([], state.projects.projects);
            projects = projects.filter(project => project._id !== action.payload._id);
            projects.push(action.payload);
            return Object.assign({}, state, {
                projects: {
                    requesting: false,
                    error: null,
                    success: true,
                    projects
                },
                currentProject: action.payload,
                changePlan: {
                    requesting: false,
                    success: true,
                    error: null
                }
            });

        case types.CHANGE_PLAN_RESET:
            return Object.assign({}, state, {
                changePlan: {
                    requesting: false,
                    success: false,
                    error: null
                }
            });

        case types.CHANGE_PLAN_REQUEST:
            return Object.assign({}, state, {
                changePlan: {
                    requesting: true,
                    success: false,
                    error: null
                }
            });

        case types.CHANGE_PLAN_FAILED:
            return Object.assign({}, state, {
                changePlan: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            });

        case types.UPGRADE_PLAN_EMPTY:
            return Object.assign({}, state, {
                canUpgrade: false
            });

        case types.EXIT_PROJECT_SUCCESS:
            return Object.assign({}, state, {
                exitProject: {
                    requesting: false,
                    error: null,
                    success: true,
                },
                currentProject: null
            });

        case types.EXIT_PROJECT_REQUEST:
            return Object.assign({}, state, {
                exitProject: {
                    requesting: true,
                    success: false,
                    error: null
                }
            });

        case types.EXIT_PROJECT_FAILED:
            return Object.assign({}, state, {
                exitProject: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            });

        case types.CHANGE_PROJECT_ROLES:
            return Object.assign({}, state, {
                currentProject: {
                    ...state.currentProject,
                    users: action.payload.find(team => team.projectId === state.currentProject._id).team
                }

            });
        case types.ALERT_OPTIONS_UPDATE_SUCCESS:
            return Object.assign({}, state, {
                alertOptionsUpdate: {
                    success: true,
                    requesting: false,
                    error: null,
                    project: action.payload
                },
                currentProject: {
                    ...state.currentProject,
                    alertEnable: action.payload.alertEnable,
                    alertOptions: action.payload.alertOptions
                }
            });

        case types.ALERT_OPTIONS_UPDATE_REQUEST:
            return Object.assign({}, state, {
                alertOptionsUpdate: {
                    ...state.alertOptionsUpdate,
                    success: false,
                    requesting: true,
                    error: null
                }
            });
        case types.ALERT_OPTIONS_UPDATE_FAILED:
            return Object.assign({}, state, {
                alertOptionsUpdate: {
                    ...state.alertOptionsUpdate,
                    success: false,
                    requesting: false,
                    error: action.payload
                }
            });

        case types.ADD_BALANCE_SUCCESS:
            return Object.assign({}, state, {
                addBalance: {
                    success: true,
                    requesting: false,
                    error: null,
                    pi: action.payload
                }
            });

        case types.ADD_BALANCE_REQUEST:
            return Object.assign({}, state, {
                addBalance: {
                    ...state.addBalance,
                    requesting: true,
                }
            });
        case types.ADD_BALANCE_FAILED:
            return Object.assign({}, state, {
                addBalance: {
                    pi: {},
                    success: false,
                    requesting: false,
                    error: action.payload
                }
            });
        case types.CHECK_CARD_REQUEST:
            return Object.assign({}, state, {
                ...state,
                checkCard: {
                    ...state.checkCard,
                    requesting: true
                }
            });

        case types.CHECK_CARD_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                checkCard: {
                    requesting: false,
                    error: null,
                    success: true,
                    pi: action.payload
                }
            });

        case types.CHECK_CARD_FAILED:
            return Object.assign({}, state, {
                ...state,
                checkCard: {
                    requesting: false,
                    success: false,
                    error: action.payload
                }
            });
        default: return state;
    }
}
