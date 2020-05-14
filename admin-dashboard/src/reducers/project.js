import {
    FETCH_PROJECTS_REQUEST,
    FETCH_PROJECTS_SUCCESS,
    FETCH_PROJECTS_FAILURE,
    FETCH_PROJECTS_RESET,
    FETCH_PROJECT_REQUEST,
    FETCH_PROJECT_SUCCESS,
    FETCH_PROJECT_FAILURE,
    FETCH_PROJECT_RESET,
    FETCH_USER_PROJECTS_REQUEST,
    FETCH_USER_PROJECTS_SUCCESS,
    FETCH_USER_PROJECTS_FAILURE,
    FETCH_USER_PROJECTS_RESET,
    DELETE_PROJECT_FAILED,
    DELETE_PROJECT_REQUEST,
    DELETE_PROJECT_RESET,
    DELETE_PROJECT_SUCCESS,
    ALERT_LIMIT_FAILED,
    ALERT_LIMIT_REQUEST,
    ALERT_LIMIT_RESET,
    ALERT_LIMIT_SUCCESS,
    BLOCK_PROJECT_FAILED,
    BLOCK_PROJECT_REQUEST,
    BLOCK_PROJECT_RESET,
    BLOCK_PROJECT_SUCCESS,
    RESTORE_PROJECT_FAILED,
    RESTORE_PROJECT_REQUEST,
    RESTORE_PROJECT_RESET,
    RESTORE_PROJECT_SUCCESS,
    UNBLOCK_PROJECT_FAILED,
    UNBLOCK_PROJECT_REQUEST,
    UNBLOCK_PROJECT_RESET,
    UNBLOCK_PROJECT_SUCCESS,
    ADD_PROJECT_NOTE_FAILURE,
    ADD_PROJECT_NOTE_REQUEST,
    ADD_PROJECT_NOTE_RESET,
    ADD_PROJECT_NOTE_SUCCESS,
    SEARCH_PROJECTS_REQUEST,
    SEARCH_PROJECTS_RESET,
    SEARCH_PROJECTS_SUCCESS,
    SEARCH_PROJECTS_FAILURE,
    CHANGE_PLAN_REQUEST,
    CHANGE_PLAN_SUCCESS,
    CHANGE_PLAN_FAILURE,
} from '../constants/project';

const INITIAL_STATE = {
    projects: {
        error: null,
        requesting: false,
        success: false,
        projects: [],
        count: null,
        limit: null,
        skip: null,
    },
    project: {
        error: null,
        requesting: false,
        success: false,
        project: null,
    },
    userProjects: {
        error: null,
        requesting: false,
        success: false,
        projects: [],
        count: null,
        limit: null,
        skip: null,
    },
    deleteProject: {
        error: null,
        requesting: false,
        success: false,
    },
    blockProject: {
        error: null,
        requesting: false,
        success: false,
    },
    alertLimit: {
        error: null,
        requesting: false,
        success: false,
    },
    restoreProject: {
        error: null,
        requesting: false,
        success: false,
    },
    unblockProject: {
        error: null,
        requesting: false,
        success: false,
    },
    newProjectNote: {
        error: null,
        requesting: false,
        success: false,
    },
    searchUsers: {
        requesting: false,
        error: null,
        success: false,
    },
};

export default function project(state = INITIAL_STATE, action) {
    switch (action.type) {
        // fetch projects list
        case FETCH_PROJECTS_REQUEST:
            return Object.assign({}, state, {
                projects: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case FETCH_PROJECTS_SUCCESS:
            return Object.assign({}, state, {
                projects: {
                    requesting: false,
                    error: null,
                    success: true,
                    projects: action.payload.data,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip,
                },
            });

        case FETCH_PROJECTS_FAILURE:
            return Object.assign({}, state, {
                projects: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case FETCH_PROJECTS_RESET:
            return Object.assign({}, state, {
                ...INITIAL_STATE,
            });

        // fetch a project
        case FETCH_PROJECT_REQUEST:
            return Object.assign({}, state, {
                project: {
                    requesting: true,
                    error: null,
                    success: false,
                    project: state.project.project,
                },
            });

        case FETCH_PROJECT_SUCCESS:
            return Object.assign({}, state, {
                project: {
                    requesting: false,
                    error: null,
                    success: true,
                    project: action.payload,
                },
            });

        case FETCH_PROJECT_FAILURE:
            return Object.assign({}, state, {
                project: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    project: state.project.project,
                },
            });

        case FETCH_PROJECT_RESET:
            return Object.assign({}, state, {
                ...INITIAL_STATE,
            });

        // fetch userProjects
        case FETCH_USER_PROJECTS_REQUEST:
            return Object.assign({}, state, {
                userProjects: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case FETCH_USER_PROJECTS_SUCCESS:
            return Object.assign({}, state, {
                userProjects: {
                    requesting: false,
                    error: null,
                    success: true,
                    projects: action.payload.data,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip,
                },
            });

        case FETCH_USER_PROJECTS_FAILURE:
            return Object.assign({}, state, {
                userProjects: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case FETCH_USER_PROJECTS_RESET:
            return Object.assign({}, state, {
                ...INITIAL_STATE,
            });

        case DELETE_PROJECT_SUCCESS:
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                project: {
                    requesting: false,
                    error: null,
                    success: true,
                    project: action.payload,
                },
            });

        case DELETE_PROJECT_REQUEST:
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });

        case DELETE_PROJECT_FAILED:
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case DELETE_PROJECT_RESET:
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: false,
                    success: false,
                    error: null,
                },
            });

        case BLOCK_PROJECT_SUCCESS:
            return Object.assign({}, state, {
                blockProject: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                project: {
                    requesting: false,
                    error: null,
                    success: true,
                    project: action.payload,
                },
            });

        case BLOCK_PROJECT_REQUEST:
            return Object.assign({}, state, {
                blockProject: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });

        case BLOCK_PROJECT_FAILED:
            return Object.assign({}, state, {
                blockProject: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case BLOCK_PROJECT_RESET:
            return Object.assign({}, state, {
                blockProject: {
                    requesting: false,
                    success: false,
                    error: null,
                },
            });

        case ALERT_LIMIT_SUCCESS:
            return Object.assign({}, state, {
                alertLimit: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                project: {
                    requesting: false,
                    error: null,
                    success: true,
                    project: action.payload,
                },
            });

        case ALERT_LIMIT_REQUEST:
            return Object.assign({}, state, {
                alertLimit: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });

        case ALERT_LIMIT_FAILED:
            return Object.assign({}, state, {
                alertLimit: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case ALERT_LIMIT_RESET:
            return Object.assign({}, state, {
                alertLimit: {
                    requesting: false,
                    success: false,
                    error: null,
                },
            });

        case RESTORE_PROJECT_SUCCESS:
            return Object.assign({}, state, {
                restoreProject: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                project: {
                    requesting: false,
                    error: null,
                    success: true,
                    project: action.payload,
                },
            });

        case RESTORE_PROJECT_REQUEST:
            return Object.assign({}, state, {
                restoreProject: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });

        case RESTORE_PROJECT_FAILED:
            return Object.assign({}, state, {
                restoreProject: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case RESTORE_PROJECT_RESET:
            return Object.assign({}, state, {
                restoreProject: {
                    requesting: false,
                    success: false,
                    error: null,
                },
            });

        case UNBLOCK_PROJECT_SUCCESS:
            return Object.assign({}, state, {
                unblockProject: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                project: {
                    requesting: false,
                    error: null,
                    success: true,
                    project: action.payload,
                },
            });

        case UNBLOCK_PROJECT_REQUEST:
            return Object.assign({}, state, {
                unblockProject: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });

        case UNBLOCK_PROJECT_FAILED:
            return Object.assign({}, state, {
                unblockProject: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case UNBLOCK_PROJECT_RESET:
            return Object.assign({}, state, {
                unblockProject: {
                    requesting: false,
                    success: false,
                    error: null,
                },
            });

        // add project admin notes
        case ADD_PROJECT_NOTE_REQUEST:
            return Object.assign({}, state, {
                newProjectNote: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case ADD_PROJECT_NOTE_SUCCESS:
            return Object.assign({}, state, {
                project: {
                    requesting: false,
                    error: null,
                    success: true,
                    project: action.payload,
                },
                newProjectNote: {
                    requesting: false,
                    error: null,
                    success: true,
                },
            });

        case ADD_PROJECT_NOTE_FAILURE:
            return Object.assign({}, state, {
                newProjectNote: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case ADD_PROJECT_NOTE_RESET:
            return Object.assign({}, state, {
                ...INITIAL_STATE,
            });

        // search projects list
        case SEARCH_PROJECTS_REQUEST:
            return Object.assign({}, state, {
                searchProjects: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case SEARCH_PROJECTS_SUCCESS:
            return Object.assign({}, state, {
                projects: {
                    requesting: false,
                    error: null,
                    success: true,
                    projects: action.payload.data,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip,
                },
                searchProjects: {
                    requesting: false,
                    error: null,
                    success: true,
                },
            });

        case SEARCH_PROJECTS_FAILURE:
            return Object.assign({}, state, {
                searchProjects: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case SEARCH_PROJECTS_RESET:
            return Object.assign({}, state, {
                ...INITIAL_STATE,
            });

        case CHANGE_PLAN_REQUEST:
            return {
                ...state,
                project: {
                    ...state.project,
                    requesting: true,
                },
            };

        case CHANGE_PLAN_SUCCESS:
            return {
                ...state,
                project: {
                    requesting: false,
                    success: true,
                    error: null,
                    project: action.payload,
                },
            };

        case CHANGE_PLAN_FAILURE:
            return {
                ...state,
                project: {
                    ...state.project,
                    error: action.payload,
                    requesting: false,
                    success: false,
                },
            };

        default:
            return state;
    }
}
