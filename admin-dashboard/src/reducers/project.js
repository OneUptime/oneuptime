import {
    FETCH_PROJECTS_REQUEST,
    FETCH_PROJECTS_SUCCESS,
    FETCH_PROJECTS_FAILURE,
    FETCH_PROJECTS_RESET,

    FETCH_USER_PROJECTS_REQUEST,
    FETCH_USER_PROJECTS_SUCCESS,
    FETCH_USER_PROJECTS_FAILURE,
    FETCH_USER_PROJECTS_RESET,

    DELETE_PROJECT_FAILED,
    DELETE_PROJECT_REQUEST,
    DELETE_PROJECT_RESET,
    DELETE_PROJECT_SUCCESS,

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
} from '../constants/project';

const INITIAL_STATE = {
    projects: {
        error: null,
        requesting: false,
        success: false,
        projects: [],
        count: null,
        limit: null,
        skip: null
    },
    userProjects: {
        error: null,
        requesting: false,
        success: false,
        projects: [],
        count: null,
        limit: null,
        skip: null
    },
    deleteProject: {
        error: null,
        requesting: false,
        success: false
    },
    blockProject: {
        error: null,
        requesting: false,
        success: false
    },
    restoreProject: {
        error: null,
        requesting: false,
        success: false
    },
    unblockProject: {
        error: null,
        requesting: false,
        success: false
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
                    skip: action.payload.skip
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
                ...INITIAL_STATE
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
                    skip: action.payload.skip
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
                ...INITIAL_STATE
            });
        
        case DELETE_PROJECT_SUCCESS:
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: false,
                    success: true,
                    error: null
                },
                projects: {
                    requesting: false,
                    error: null,
                    success: true,
                    projects: [...state.projects.projects.filter(project=> project._id !== action.payload._id), action.payload],
                    count: state.projects.count,
                    limit: state.projects.limit,
                    skip: state.projects.skip
                }
            });
    
        case DELETE_PROJECT_REQUEST:
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: true,
                    success: false,
                    error: null
                }
            });

        case DELETE_PROJECT_FAILED:
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            });

        case DELETE_PROJECT_RESET:
            return Object.assign({}, state, {
                deleteProject: {
                    requesting: false,
                    success: false,
                    error: null,
                }
            });
        
        case BLOCK_PROJECT_SUCCESS:
            return Object.assign({}, state, {
                blockProject: {
                    requesting: false,
                    success: true,
                    error: null
                },
                projects: {
                    requesting: false,
                    error: null,
                    success: true,
                    projects: [...state.projects.projects.filter(project=> project._id !== action.payload._id), action.payload],
                    count: state.projects.count,
                    limit: state.projects.limit,
                    skip: state.projects.skip
                }
            });
    
        case BLOCK_PROJECT_REQUEST:
            return Object.assign({}, state, {
                blockProject: {
                    requesting: true,
                    success: false,
                    error: null
                }
            });

        case BLOCK_PROJECT_FAILED:
            return Object.assign({}, state, {
                blockProject: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            });

        case BLOCK_PROJECT_RESET:
            return Object.assign({}, state, {
                blockProject: {
                    requesting: false,
                    success: false,
                    error: null,
                }
            });

        case RESTORE_PROJECT_SUCCESS:
            return Object.assign({}, state, {
                restoreProject: {
                    requesting: false,
                    success: true,
                    error: null
                },
                projects: {
                    requesting: false,
                    error: null,
                    success: true,
                    projects: [...state.projects.projects.filter(project=> project._id !== action.payload._id), action.payload],
                    count: state.projects.count,
                    limit: state.projects.limit,
                    skip: state.projects.skip
                }
            });

        case RESTORE_PROJECT_REQUEST:
            return Object.assign({}, state, {
                restoreProject: {
                    requesting: true,
                    success: false,
                    error: null
                }
            });

        case RESTORE_PROJECT_FAILED:
            return Object.assign({}, state, {
                restoreProject: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            });

        case RESTORE_PROJECT_RESET:
            return Object.assign({}, state, {
                restoreProject: {
                    requesting: false,
                    success: false,
                    error: null,
                }
            });

        case UNBLOCK_PROJECT_SUCCESS:
            return Object.assign({}, state, {
                unblockProject: {
                    requesting: false,
                    success: true,
                    error: null
                },
                projects: {
                    requesting: false,
                    error: null,
                    success: true,
                    projects: [...state.projects.projects.filter(project=> project._id !== action.payload._id), action.payload],
                    count: state.projects.count,
                    limit: state.projects.limit,
                    skip: state.projects.skip
                }
            });

        case UNBLOCK_PROJECT_REQUEST:
            return Object.assign({}, state, {
                unblockProject: {
                    requesting: true,
                    success: false,
                    error: null
                }
            });

        case UNBLOCK_PROJECT_FAILED:
            return Object.assign({}, state, {
                unblockProject: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            });

        case UNBLOCK_PROJECT_RESET:
            return Object.assign({}, state, {
                unblockProject: {
                    requesting: false,
                    success: false,
                    error: null,
                }
            });

        case UNBLOCK_PROJECT_REQUEST:
            return Object.assign({}, state, {
                unblockProject: {
                    requesting: true,
                    success: false,
                    error: null
                }
            });

        case UNBLOCK_PROJECT_FAILED:
            return Object.assign({}, state, {
                unblockProject: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            });

        case UNBLOCK_PROJECT_RESET:
            return Object.assign({}, state, {
                unblockProject: {
                    requesting: false,
                    success: false,
                    error: null,
                }
            });

        default: return state;
    }
}
