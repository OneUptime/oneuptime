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
    FETCH_PROJECT_TEAM_REQUEST,
    FETCH_PROJECT_TEAM_SUCCESS,
    FETCH_PROJECT_TEAM_ERROR,
    TEAM_DELETE_REQUEST,
    TEAM_DELETE_SUCCESS,
    TEAM_DELETE_FAILURE,
    TEAM_DELETE_RESET,
    USER_CREATE_REQUEST,
    USER_CREATE_SUCCESS,
    USER_CREATE_FAILURE,
    USER_UPDATE_ROLE_REQUEST,
    USER_UPDATE_ROLE_SUCCESS,
    USER_UPDATE_ROLE_FAILURE,
    PAGINATE_USERS_NEXT,
    PAGINATE_USERS_PREV,
    PROJECT_BALANCE_UPDATE_REQUEST,
    PROJECT_BALANCE_UPDATE_SUCCESS,
    PROJECT_BALANCE_UPDATE_FAILURE,
    PROJECT_DOMAIN_REQUEST,
    PROJECT_DOMAIN_SUCCESS,
    PROJECT_DOMAIN_FAILURE,
    DELETE_PROJECT_DOMAIN_REQUEST,
    DELETE_PROJECT_DOMAIN_SUCCESS,
    DELETE_PROJECT_DOMAIN_FAILURE,
    VERIFY_PROJECT_DOMAIN_REQUEST,
    VERIFY_PROJECT_DOMAIN_SUCCESS,
    VERIFY_PROJECT_DOMAIN_FAILURE,
    RESET_VERIFY_PROJECT_DOMAIN,
    UNVERIFY_PROJECT_DOMAIN_REQUEST,
    UNVERIFY_PROJECT_DOMAIN_SUCCESS,
    UNVERIFY_PROJECT_DOMAIN_FAILURE,
    RESET_UNVERIFY_PROJECT_DOMAIN,
    RESET_PROJECT_DOMAIN_REQUEST,
    RESET_PROJECT_DOMAIN_SUCCESS,
    RESET_PROJECT_DOMAIN_FAILURE,
    RESET_PROJECT_DOMAIN_ON_MOUNT,
    RESET_DELETE_PROJECT_DOMAIN,
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
    projectTeam: {
        requesting: false,
        error: null,
        success: false,
        team: [],
        pages: 1,
    },
    teamDelete: {
        error: null,
        requesting: false,
        success: false,
        deleting: [],
    },
    updateUser: {
        error: null,
        requesting: false,
        success: false,
        updating: [],
    },
    createUser: {
        error: null,
        requesting: false,
        success: false,
    },
    updateBalance: {
        error: null,
        requesting: false,
        success: false,
    },
    projectDomain: {
        error: null,
        requesting: false,
        domains: [],
        success: false,
        count: null,
        limit: null,
        skip: null,
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
    unverifyDomain: {
        requesting: false,
        success: false,
        error: null,
    },
    resetDomain: {
        requesting: false,
        success: false,
        error: null,
    },
    searchProjects: {
        requesting: false,
        error: null,
        success: false,
    },
};

export default function project(state = INITIAL_STATE, action: $TSFixMe) {
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
        //fetch project members
        case FETCH_PROJECT_TEAM_REQUEST:
            return Object.assign({}, state, {
                projectTeam: {
                    requesting: true,
                    error: null,
                    success: false,
                    page: 1,
                },
            });
        case FETCH_PROJECT_TEAM_SUCCESS:
            return Object.assign({}, state, {
                projectTeam: {
                    requesting: false,
                    error: null,
                    success: true,
                    page: 1,
                    team: action.payload,
                },
            });
        case FETCH_PROJECT_TEAM_ERROR:
            return Object.assign({}, state, {
                projectTeam: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });
        //create user
        case USER_CREATE_REQUEST:
            return Object.assign({}, state, {
                createUser: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });
        case USER_CREATE_SUCCESS:
            return Object.assign({}, state, {
                createUser: {
                    requesting: false,
                    error: null,
                    success: true,
                },
                projectTeam: {
                    ...state.projectTeam,
                    team: {
                        ...state.projectTeam.team,
                        teamMembers: action.payload,
                        count: action.payload.length,
                    },
                },
            });
        case USER_CREATE_FAILURE:
            return Object.assign({}, state, {
                createUser: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });
        //update project users role
        case USER_UPDATE_ROLE_REQUEST:
            return Object.assign({}, state, {
                updateUser: {
                    ...state.updateUser,
                    requesting: true,
                    error: null,
                    success: false,
                    updating: state.updateUser.updating.concat([
                        // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
                        action.payload,
                    ]),
                },
            });
        case USER_UPDATE_ROLE_SUCCESS:
            return Object.assign({}, state, {
                updateUser: {
                    ...state.updateUser,
                    requesting: false,
                    error: null,
                    success: false,
                    updating: [],
                },
                projectTeam: {
                    ...state.projectTeam,
                    team: {
                        ...state.projectTeam.team,
                        teamMembers: action.payload.team,
                    },
                },
            });
        //updating project balance
        case PROJECT_BALANCE_UPDATE_REQUEST:
            return {
                ...state,
                updateBalance: {
                    ...state.updateBalance,
                    error: null,
                    requesting: true,
                    success: false,
                },
            };
        case PROJECT_BALANCE_UPDATE_SUCCESS:
            return {
                ...state,
                updateBalance: {
                    ...state.updateBalance,
                    error: null,
                    requesting: false,
                    success: true,
                },
                project: {
                    ...state.project,
                    project: action.payload,
                },
            };
        case PROJECT_BALANCE_UPDATE_FAILURE:
            return {
                ...state,
                updateBalance: {
                    ...state.updateBalance,
                    error: action.payload,
                    requesting: false,
                    success: false,
                },
            };
        case USER_UPDATE_ROLE_FAILURE:
            return {
                ...state,
                teamDelete: {
                    ...state.teamDelete,
                    error: action.payload,
                    requesting: false,
                    success: false,
                    deleting: [],
                },
            };
        //project domain
        case PROJECT_DOMAIN_SUCCESS:
            return {
                ...state,
                projectDomain: {
                    ...state.projectDomain,
                    error: null,
                    requesting: false,
                    success: true,
                    domains: action.payload.data,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip,
                },
            };
        case PROJECT_DOMAIN_REQUEST:
            return {
                ...state,
                projectDomain: {
                    ...state.projectDomain,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case PROJECT_DOMAIN_FAILURE:
            return {
                ...state,
                projectDomain: {
                    ...state.projectDomain,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        //delete project domain
        case DELETE_PROJECT_DOMAIN_REQUEST:
            return {
                ...state,
                deleteDomain: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case DELETE_PROJECT_DOMAIN_FAILURE:
            return {
                ...state,
                deleteDomain: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case DELETE_PROJECT_DOMAIN_SUCCESS:
            return {
                ...state,
                deleteDomain: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            };
        case RESET_DELETE_PROJECT_DOMAIN:
            return {
                ...state,
                deleteDomain: {
                    requesting: false,
                    success: false,
                    error: null,
                },
            };
        //verify project domain
        case VERIFY_PROJECT_DOMAIN_REQUEST:
            return {
                ...state,
                verifyDomain: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case VERIFY_PROJECT_DOMAIN_SUCCESS:
            return {
                ...state,
                verifyDomain: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            };

        case VERIFY_PROJECT_DOMAIN_FAILURE:
            return {
                ...state,
                verifyDomain: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case RESET_VERIFY_PROJECT_DOMAIN:
            return {
                ...state,
                verifyDomain: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        //unverify project domain
        case UNVERIFY_PROJECT_DOMAIN_REQUEST:
            return {
                ...state,
                unverifyDomain: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case UNVERIFY_PROJECT_DOMAIN_SUCCESS:
            return {
                ...state,
                unverifyDomain: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            };

        case UNVERIFY_PROJECT_DOMAIN_FAILURE:
            return {
                ...state,
                unverifyDomain: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case RESET_UNVERIFY_PROJECT_DOMAIN:
            return {
                ...state,
                unverifyDomain: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        //reset project domain
        case RESET_PROJECT_DOMAIN_REQUEST:
            return {
                ...state,
                resetDomain: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case RESET_PROJECT_DOMAIN_SUCCESS:
            return {
                ...state,
                resetDomain: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            };
        case RESET_PROJECT_DOMAIN_FAILURE:
            return {
                ...state,
                resetDomain: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case RESET_PROJECT_DOMAIN_ON_MOUNT:
            return {
                ...state,
                resetDomain: {
                    requesting: false,
                    success: false,
                    error: null,
                },
            };
        //users pagination
        case PAGINATE_USERS_NEXT:
            return Object.assign({}, state, {
                projectTeam: {
                    ...state.projectTeam,
                    // @ts-expect-error ts-migrate(2551) FIXME: Property 'page' does not exist on type '{ requesti... Remove this comment to see the full error message
                    page: state.projectTeam.page + 1,
                },
            });
        case PAGINATE_USERS_PREV:
            return Object.assign({}, state, {
                projectTeam: {
                    ...state.projectTeam,
                    page:
                        // @ts-expect-error ts-migrate(2551) FIXME: Property 'page' does not exist on type '{ requesti... Remove this comment to see the full error message
                        state.projectTeam.page > 1
                            ? // @ts-expect-error ts-migrate(2551) FIXME: Property 'page' does not exist on type '{ requesti... Remove this comment to see the full error message
                              state.projectTeam.page - 1
                            : 1,
                },
            });
        //delete users
        case TEAM_DELETE_REQUEST:
            return {
                ...state,
                teamDelete: {
                    ...state.teamDelete,
                    error: null,
                    requesting: true,
                    success: false,
                    deleting: state.teamDelete.deleting.concat([
                        // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
                        action.payload,
                    ]),
                },
            };
        case TEAM_DELETE_SUCCESS:
            return {
                ...state,
                teamDelete: {
                    ...state.teamDelete,
                    error: null,
                    requesting: false,
                    success: true,
                    deleting: [],
                },
                projectTeam: {
                    ...state.projectTeam,
                    team: {
                        ...state.projectTeam.team,
                        teamMembers: action.payload,
                        count: action.payload.length,
                    },
                },
            };
        case TEAM_DELETE_FAILURE:
            return {
                ...state,
                teamDelete: {
                    ...state.teamDelete,
                    error: action.payload,
                    requesting: false,
                    success: false,
                    deleting: [],
                },
            };

        case TEAM_DELETE_RESET:
            return {
                ...state,
                teamDelete: {
                    ...state.teamDelete,
                    error: null,
                    requesting: false,
                    success: false,
                    deleting: [],
                },
            };
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
                projects: {
                    requesting: false,
                    error: null,
                    success: true,
                    projects: state.projects.projects.map(project => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                        if (project._id === action.payload._id) {
                            // @ts-expect-error ts-migrate(2322) FIXME: Type 'any' is not assignable to type 'never'.
                            project = action.payload;
                        }
                        return project;
                    }),
                },
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
