import {
    FETCH_USERS_REQUEST,
    FETCH_USERS_SUCCESS,
    FETCH_USERS_FAILURE,
    FETCH_USERS_RESET,

    UPDATE_USER_SETTING_REQUEST,
    UPDATE_USER_SETTING_SUCCESS,
    UPDATE_USER_SETTING_FAILURE,
    UPDATE_USER_SETTING_RESET,

    DELETE_USER_FAILED,
    DELETE_USER_REQUEST,
    DELETE_USER_RESET,
    DELETE_USER_SUCCESS,

    RESTORE_USER_FAILED,
    RESTORE_USER_REQUEST,
    RESTORE_USER_RESET,
    RESTORE_USER_SUCCESS,

    BLOCK_USER_FAILED,
    BLOCK_USER_REQUEST,
    BLOCK_USER_RESET,
    BLOCK_USER_SUCCESS,

    UNBLOCK_USER_FAILED,
    UNBLOCK_USER_REQUEST,
    UNBLOCK_USER_RESET,
    UNBLOCK_USER_SUCCESS,

    ADD_USER_NOTE_REQUEST, 
    ADD_USER_NOTE_RESET,
    ADD_USER_NOTE_SUCCESS,
    ADD_USER_NOTE_FAILURE,
} from '../constants/user';

const INITIAL_STATE = {
    users: {
        error: null,
        requesting: false,
        success: false,
        users: [],
        count: null,
        limit: null,
        skip: null
    },
    userSetting: {
        error: null,
        requesting: false,
        success: false,
        data: {}
    },
    deleteUser: {
        error: null,
        requesting: false,
        success: false
    },
    restoreUser: {
        error: null,
        requesting: false,
        success: false
    },
    blockUser: {
        error: null,
        requesting: false,
        success: false
    },
    unblockUser: {
        error: null,
        requesting: false,
        success: false
    },
    newUserNote: {
        requesting: false,
        error: null,
        success: false,
    },
};

export default function user(state = INITIAL_STATE, action) {

    switch (action.type) {

        // fetch users list
        case FETCH_USERS_REQUEST:

            return Object.assign({}, state, {
                users: {
                    requesting: true,
                    error: null,
                    success: false,
                },

            });

        case FETCH_USERS_SUCCESS:
            return Object.assign({}, state, {
                users: {
                    requesting: false,
                    error: null,
                    success: true,
                    users: action.payload.data,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip
                },
            });

        case FETCH_USERS_FAILURE:

            return Object.assign({}, state, {
                users: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case FETCH_USERS_RESET:

            return Object.assign({}, state, {
                ...INITIAL_STATE
            });


        //update user setting
        case UPDATE_USER_SETTING_REQUEST:

            return Object.assign({}, state, {
                userSetting: {
                    requesting: true,
                    error: null,
                    success: false,
                },

            });

        case UPDATE_USER_SETTING_SUCCESS:
            return Object.assign({}, state, {
                userSetting: {
                    requesting: false,
                    error: null,
                    success: true,
                    data: action.payload
                },
                users: {
                    requesting: false,
                    error: null,
                    success: true,
                    users: state.users.users.map(user => user._id === action.payload._id ? action.payload : user),
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip
                }
            });

        case UPDATE_USER_SETTING_FAILURE:

            return Object.assign({}, state, {
                userSetting: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case UPDATE_USER_SETTING_RESET:

            return Object.assign({}, state, {
                ...INITIAL_STATE
            });
        
        case DELETE_USER_SUCCESS:
            return Object.assign({}, state, {
                deleteUser: {
                    requesting: false,
                    success: true,
                    error: null
                },
                users: {
                    requesting: false,
                    error: null,
                    success: true,
                    users: [...state.users.users.filter(user=> user._id !== action.payload._id), action.payload],
                    count: state.users.count,
                    limit: state.users.limit,
                    skip: state.users.skip
                }
            });

        case DELETE_USER_REQUEST:
            return Object.assign({}, state, {
                deleteUser: {
                    requesting: true,
                    success: false,
                    error: null
                }
            });

        case DELETE_USER_FAILED:
            return Object.assign({}, state, {
                deleteUser: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            });

        case DELETE_USER_RESET:
            return Object.assign({}, state, {
                deleteUser: {
                    requesting: false,
                    success: false,
                    error: null,
                }
            });

        case RESTORE_USER_SUCCESS:
            return Object.assign({}, state, {
                restoreUser: {
                    requesting: false,
                    success: true,
                    error: null
                },
                users: {
                    requesting: false,
                    error: null,
                    success: true,
                    users: [...state.users.users.filter(user=> user._id !== action.payload._id), action.payload],
                    count: state.users.count,
                    limit: state.users.limit,
                    skip: state.users.skip
                }
            });

        case RESTORE_USER_REQUEST:
            return Object.assign({}, state, {
                restoreUser: {
                    requesting: true,
                    success: false,
                    error: null
                }
            });

        case RESTORE_USER_FAILED:
            return Object.assign({}, state, {
                restoreUser: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            });

        case RESTORE_USER_RESET:
            return Object.assign({}, state, {
                restoreUser: {
                    requesting: false,
                    success: false,
                    error: null,
                }
            });

        case BLOCK_USER_SUCCESS:
            return Object.assign({}, state, {
                blockUser: {
                    requesting: false,
                    success: true,
                    error: null
                },
                users: {
                    requesting: false,
                    error: null,
                    success: true,
                    users: [...state.users.users.filter(user=> user._id !== action.payload._id), action.payload],
                    count: state.users.count,
                    limit: state.users.limit,
                    skip: state.users.skip
                }
            });
    
        case BLOCK_USER_REQUEST:
            return Object.assign({}, state, {
                blockUser: {
                    requesting: true,
                    success: false,
                    error: null
                }
            });

        case BLOCK_USER_FAILED:
            return Object.assign({}, state, {
                blockUser: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            });

        case BLOCK_USER_RESET:
            return Object.assign({}, state, {
                blockUser: {
                    requesting: false,
                    success: false,
                    error: null,
                }
            });

        case UNBLOCK_USER_SUCCESS:
            return Object.assign({}, state, {
                unblockUser: {
                    requesting: false,
                    success: true,
                    error: null
                },
                users: {
                    requesting: false,
                    error: null,
                    success: true,
                    users: [...state.users.users.filter(user=> user._id !== action.payload._id), action.payload],
                    count: state.users.count,
                    limit: state.users.limit,
                    skip: state.users.skip
                }
            });

        case UNBLOCK_USER_REQUEST:
            return Object.assign({}, state, {
                unblockUser: {
                    requesting: true,
                    success: false,
                    error: null
                }
            });

        case UNBLOCK_USER_FAILED:
            return Object.assign({}, state, {
                unblockUser: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            });

        case UNBLOCK_USER_RESET:
            return Object.assign({}, state, {
                unblockUser: {
                    requesting: false,
                    success: false,
                    error: null,
                }
            });
            // add user admin notes
        case ADD_USER_NOTE_REQUEST:

            return Object.assign({}, state, {
                newUserNote: {
                    requesting: true,
                    error: null,
                    success: false,
                },

            });

        case ADD_USER_NOTE_SUCCESS:
            return Object.assign({}, state, {
                users: {
                    requesting: false,
                    error: null,
                    success: true,
                    users: state.users.users.map(user=> {
                        user.adminNotes = user._id === action.payload.projectId ? action.payload.notes : user.adminNotes;
                        return user;
                    }),
                    count: state.users.count,
                    limit: state.users.limit,
                    skip: state.users.skip
                },
                newUserNote:{
                    requesting: false,
                    error: null,
                    success: true
                }
            });

        case ADD_USER_NOTE_FAILURE:

            return Object.assign({}, state, {
                newUserNote: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case ADD_USER_NOTE_RESET:

            return Object.assign({}, state, {
                ...INITIAL_STATE
            });

        default: return state;
    }
}
