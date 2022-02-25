import * as types from '../constants/report';

const initialState = {
    activeMembers: {
        requesting: false,
        error: null,
        success: false,
        members: [],
        count: null,
    },
    activeMonitors: {
        requesting: false,
        error: null,
        success: false,
        monitors: [],
        count: null,
    },
    incidents: {
        requesting: true,
        error: null,
        success: false,
        reports: [],
    },
    averageTime: {
        requesting: true,
        error: null,
        success: false,
        reports: [],
    },
};

export default function incidents(state = initialState, action) {
    switch (action.type) {
        case types.GET_ACTIVE_MEMBERS_REQUEST:
            return Object.assign({}, state, {
                activeMembers: {
                    ...state.activeMembers,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case types.GET_ACTIVE_MEMBERS_SUCCESS:
            return Object.assign({}, state, {
                activeMembers: {
                    requesting: false,
                    error: null,
                    success: true,
                    members: action.payload.data,
                    count: action.payload.count,
                },
            });

        case types.GET_ACTIVE_MEMBERS_FAILED:
            return Object.assign({}, state, {
                activeMembers: {
                    ...state.activeMembers,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case types.GET_ACTIVE_MONITORS_REQUEST:
            return Object.assign({}, state, {
                activeMonitors: {
                    ...state.activeMonitors,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case types.GET_ACTIVE_MONITORS_SUCCESS:
            return Object.assign({}, state, {
                activeMonitors: {
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: action.payload.data,
                    count: action.payload.count,
                },
            });

        case types.GET_ACTIVE_MONITORS_FAILED:
            return Object.assign({}, state, {
                activeMonitors: {
                    ...state.activeMonitors,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case types.GET_INCIDENTS_REQUEST:
            return Object.assign({}, state, {
                incidents: {
                    ...state.incidents,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case types.GET_INCIDENTS_SUCCESS:
            return Object.assign({}, state, {
                incidents: {
                    requesting: false,
                    error: null,
                    success: true,
                    reports: action.payload.data,
                },
            });

        case types.GET_INCIDENTS_FAILED:
            return Object.assign({}, state, {
                incidents: {
                    ...state.incidents,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case types.GET_RESOLVE_TIME_REQUEST:
            return Object.assign({}, state, {
                averageTime: {
                    ...state.averageTime,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case types.GET_RESOLVE_TIME_SUCCESS:
            return Object.assign({}, state, {
                averageTime: {
                    requesting: false,
                    error: null,
                    success: true,
                    reports: action.payload.data,
                },
            });

        case types.GET_RESOLVE_TIME_FAILED:
            return Object.assign({}, state, {
                averageTime: {
                    ...state.averageTime,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        default:
            return state;
    }
}
