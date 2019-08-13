import {
    FETCH_PROJECTS_REQUEST,
    FETCH_PROJECTS_SUCCESS,
    FETCH_PROJECTS_FAILURE,
    FETCH_PROJECTS_RESET,

    FETCH_USER_PROJECTS_REQUEST,
    FETCH_USER_PROJECTS_SUCCESS,
    FETCH_USER_PROJECTS_FAILURE,
    FETCH_USER_PROJECTS_RESET
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
    }
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


        default: return state;
    }
}
