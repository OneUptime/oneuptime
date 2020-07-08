import {
    GET_MS_TEAMS_REQUEST,
    GET_MS_TEAMS_FAILED,
    GET_MS_TEAMS_RESET,
    GET_MS_TEAMS_SUCCESS,
    DELETE_MS_TEAMS_FAILED,
    DELETE_MS_TEAMS_REQUEST,
    DELETE_MS_TEAMS_RESET,
    DELETE_MS_TEAMS_SUCCESS,
    CREATE_MS_TEAMS_FAILED,
    CREATE_MS_TEAMS_REQUEST,
    CREATE_MS_TEAMS_RESET,
    CREATE_MS_TEAMS_SUCCESS,
    UPDATE_MS_TEAMS_REQUEST,
    UPDATE_MS_TEAMS_FAILED,
    UPDATE_MS_TEAMS_SUCCESS,
    UPDATE_MS_TEAMS_RESET,
    PAGINATE_PREV,
    PAGINATE_NEXT,
    PAGINATE_RESET,
} from '../constants/msteams';

const initialState = {
    msTeams: {
        error: null,
        requesting: false,
        success: false,
        msTeams: [],
        count: null,
        limit: null,
        skip: null,
    },
    deleteMsTeams: {
        error: null,
        requesting: false,
        success: false,
    },
    createMsTeams: {
        error: null,
        requesting: false,
        success: false,
    },
    updateMsTeams: {
        error: null,
        requesting: false,
        success: false,
    },
    pages: {
        counter: 0,
    },
};

export default (state = initialState, action) => {
    let msTeams, index, count;
    switch (action.type) {
        case GET_MS_TEAMS_FAILED:
            return Object.assign({}, state, {
                msTeams: {
                    ...state.msTeams,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case GET_MS_TEAMS_SUCCESS:
            return Object.assign({}, state, {
                msTeams: {
                    requesting: false,
                    success: true,
                    error: null,
                    msTeams: action.payload.data,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip,
                },
            });

        case GET_MS_TEAMS_REQUEST:
            return Object.assign({}, state, {
                msTeams: {
                    ...state.msTeams,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case GET_MS_TEAMS_RESET:
            return Object.assign({}, state, {
                msTeams: {
                    error: null,
                    requesting: false,
                    success: false,
                    msTeams: [],
                    count: null,
                    limit: null,
                    skip: null,
                },
            });

        case DELETE_MS_TEAMS_FAILED:
            return Object.assign({}, state, {
                deleteMsTeams: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case DELETE_MS_TEAMS_SUCCESS:
            msTeams = Object.assign([], state.msTeams.msTeams);
            index = msTeams.findIndex(team => team._id === action.payload._id);
            msTeams.splice(index, 1);
            count = state.msTeams.count - 1;
            return Object.assign({}, state, {
                deleteMsTeams: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                msTeams: {
                    requesting: false,
                    success: true,
                    error: null,
                    msTeams,
                    skip: state.msTeams.skip,
                    limit: state.msTeams.limit,
                    count: count,
                },
            });

        case DELETE_MS_TEAMS_REQUEST:
            return Object.assign({}, state, {
                deleteMsTeams: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case DELETE_MS_TEAMS_RESET:
            return Object.assign({}, state, {
                deleteMsTeams: {
                    error: null,
                    requesting: false,
                    success: false,
                },
            });

        case CREATE_MS_TEAMS_FAILED:
            return Object.assign({}, state, {
                createMsTeams: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case CREATE_MS_TEAMS_SUCCESS:
            msTeams = Object.assign([], state.msTeams.msTeams);
            action.payload._id && msTeams.push(action.payload);
            count = state.msTeams.count + 1;

            return Object.assign({}, state, {
                createMsTeams: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                msTeams: {
                    requesting: false,
                    success: true,
                    error: null,
                    msTeams,
                    skip: state.msTeams.skip,
                    limit: state.msTeams.limit,
                    count: count,
                },
            });

        case CREATE_MS_TEAMS_REQUEST:
            return Object.assign({}, state, {
                createMsTeams: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case CREATE_MS_TEAMS_RESET:
            return Object.assign({}, state, {
                createMsTeams: {
                    error: null,
                    requesting: false,
                    success: false,
                },
            });

        case UPDATE_MS_TEAMS_FAILED:
            return Object.assign({}, state, {
                updateMsTeams: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case UPDATE_MS_TEAMS_SUCCESS:
            msTeams = Object.assign([], state.msTeams.msTeams);
            index = msTeams.findIndex(hook => hook._id === action.payload._id);
            msTeams[index] = action.payload;

            return Object.assign({}, state, {
                updateMsTeams: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                msTeams: {
                    requesting: false,
                    success: true,
                    error: null,
                    msTeams,
                    skip: state.msTeams.skip,
                    limit: state.msTeams.limit,
                    count: state.msTeams.count,
                },
            });

        case UPDATE_MS_TEAMS_REQUEST:
            return Object.assign({}, state, {
                updateMsTeams: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case UPDATE_MS_TEAMS_RESET:
            return Object.assign({}, state, {
                createMsTeams: {
                    error: null,
                    requesting: false,
                    success: false,
                },
            });

        case PAGINATE_NEXT:
            return {
                ...state,
                pages: {
                    counter: state.pages.counter + 1,
                },
            };

        case PAGINATE_PREV:
            return {
                ...state,
                pages: {
                    counter: state.pages.counter - 1,
                },
            };

        case PAGINATE_RESET:
            return {
                ...state,
                pages: {
                    counter: 0,
                },
            };
        default:
            return state;
    }
};
