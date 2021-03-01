import * as types from '../constants/callRouting';

const initialState = {
    allNumbers: {
        requesting: false,
        error: null,
        success: false,
        numbers: [],
        count: null,
        limit: 10,
        skip: null,
    },
    teamMembersAndSchedules: {
        requesting: false,
        error: null,
        success: false,
        teamMembers: [],
        schedules: [],
    },
    addCallRoutingSchedule: {
        requesting: false,
        error: null,
        success: false,
        schedule: {},
    },
    fetchNumber: {
        requesting: false,
        error: null,
        success: false,
        numbers: {},
    },
    saveNumber: {
        requesting: false,
        error: null,
        success: false,
        numbers: [],
    },
    removeNumber: {
        requesting: false,
        error: null,
        success: false,
        numbers: [],
    },
    callRoutingLogs: {
        requesting: false,
        error: null,
        success: false,
        logs: [],
        count: null,
        limit: 10,
        skip: null,
    },
    introAudioState: {
        requesting: false,
        error: null,
        success: false,
    },
};

export default function card(state = initialState, action) {
    switch (action.type) {
        case types.GET_CALL_ROUTING_NUMBERS_REQUEST:
            return Object.assign({}, state, {
                ...state,
                allNumbers: {
                    ...state.allNumbers,
                    error: null,
                    success: false,
                    requesting: true,
                },
            });

        case types.GET_CALL_ROUTING_NUMBERS_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                allNumbers: {
                    ...state.allNumbers,
                    requesting: false,
                    error: null,
                    success: true,
                    numbers: action.payload.numbers,
                    skip: action.payload.skip,
                    limit: action.payload.limit,
                    count: action.payload.count,
                },
            });

        case types.GET_CALL_ROUTING_NUMBERS_FAILURE:
            return Object.assign({}, state, {
                ...state,
                allNumbers: {
                    ...state.allNumbers,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case types.GET_TEAM_MEMBERS_AND_SCHEDULES_REQUEST:
            return Object.assign({}, state, {
                ...state,
                teamMembersAndSchedules: {
                    ...state.teamMembersAndSchedules,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case types.GET_TEAM_MEMBERS_AND_SCHEDULES_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                teamMembersAndSchedules: {
                    ...state.teamMembersAndSchedules,
                    requesting: false,
                    error: null,
                    success: true,
                    teamMembers: action.payload.teams,
                    schedules: action.payload.schedules,
                },
            });

        case types.GET_TEAM_MEMBERS_AND_SCHEDULES_FAILURE:
            return Object.assign({}, state, {
                ...state,
                teamMembersAndSchedules: {
                    ...state.teamMembersAndSchedules,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case types.GET_TEAM_MEMBERS_AND_SCHEDULES_RESET:
            return Object.assign({}, state, {
                ...state,
                teamMembersAndSchedules: initialState.teamMembersAndSchedules,
            });

        case types.FETCH_NUMBERS_REQUEST:
            return Object.assign({}, state, {
                ...state,
                fetchNumber: {
                    ...state.fetchNumber,
                    error: null,
                    success: false,
                    requesting: true,
                },
            });

        case types.FETCH_NUMBERS_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                fetchNumber: {
                    ...state.fetchNumber,
                    requesting: false,
                    error: null,
                    success: true,
                    numbers: action.payload,
                },
            });

        case types.FETCH_NUMBERS_FAILURE:
            return Object.assign({}, state, {
                ...state,
                fetchNumber: {
                    ...state.fetchNumber,
                    requesting: false,
                    success: false,
                    error: action.payload,
                    numbers: {},
                },
            });

        case types.FETCH_NUMBERS_RESET:
            return Object.assign({}, state, {
                ...state,
                fetchNumber: initialState.fetchNumber,
            });

        case types.ADD_CALL_ROUTING_NUMBER_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                saveNumber: {
                    ...state.saveNumber,
                    requesting: false,
                    error: null,
                    success: true,
                    numbers: action.payload,
                },
                allNumbers: {
                    ...state.allNumbers,
                    numbers: state.allNumbers.numbers.concat([action.payload]),
                },
            });

        case types.ADD_CALL_ROUTING_NUMBER_FAILURE:
            return Object.assign({}, state, {
                ...state,
                saveNumber: {
                    ...state.saveNumber,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case types.ADD_CALL_ROUTING_NUMBER_REQUEST:
            return Object.assign({}, state, {
                ...state,
                saveNumber: {
                    ...state.saveNumber,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case types.ADD_CALL_ROUTING_NUMBER_RESET:
            return Object.assign({}, state, {
                ...state,
                saveNumber: initialState.saveNumber,
            });

        case types.ADD_CALL_ROUTING_SCHEDULE_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                addCallRoutingSchedule: {
                    ...state.addCallRoutingSchedule,
                    requesting: false,
                    error: null,
                    success: false,
                    schedule: action.payload,
                },
                allNumbers: {
                    ...state.allNumbers,
                    numbers: state.allNumbers.numbers.map(n => {
                        if (String(n._id) === String(action.payload._id)) {
                            return action.payload;
                        } else {
                            return n;
                        }
                    }),
                },
            });

        case types.ADD_CALL_ROUTING_SCHEDULE_FAILURE:
            return Object.assign({}, state, {
                ...state,
                addCallRoutingSchedule: {
                    ...state.addCallRoutingSchedule,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case types.ADD_CALL_ROUTING_SCHEDULE_REQUEST:
            return Object.assign({}, state, {
                ...state,
                addCallRoutingSchedule: {
                    ...state.addCallRoutingSchedule,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case types.ADD_CALL_ROUTING_SCHEDULE_RESET:
            return Object.assign({}, state, {
                ...state,
                addCallRoutingSchedule: initialState.addCallRoutingSchedule,
            });

        case types.REMOVE_NUMBERS_REQUEST:
            return Object.assign({}, state, {
                ...state,
                removeNumber: {
                    ...state.removeNumber,
                    requesting: action.payload,
                    error: null,
                    success: false,
                },
            });

        case types.REMOVE_NUMBERS_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                removeNumber: {
                    ...state.removeNumber,
                    requesting: false,
                    error: null,
                    success: true,
                    numbers: action.payload,
                },
                allNumbers: {
                    ...state.allNumbers,
                    numbers: state.allNumbers.numbers.filter(
                        n => String(n._id) !== String(action.payload._id)
                    ),
                },
            });

        case types.REMOVE_NUMBERS_FAILURE:
            return Object.assign({}, state, {
                ...state,
                removeNumber: {
                    ...state.removeNumber,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case types.REMOVE_INTRO_AUDIO_REQUEST:
            return Object.assign({}, state, {
                ...state,
                introAudioState: {
                    ...state.introAudioState,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case types.REMOVE_INTRO_AUDIO_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                introAudioState: {
                    ...state.introAudioState,
                    requesting: false,
                    error: null,
                    success: true,
                },
                allNumbers: {
                    ...state.allNumbers,
                    numbers: state.allNumbers.numbers.map(n => {
                        if (String(n._id) === String(action.payload._id)) {
                            return action.payload;
                        } else {
                            return n;
                        }
                    }),
                },
            });

        case types.REMOVE_INTRO_AUDIO_FAILURE:
            return Object.assign({}, state, {
                ...state,
                introAudioState: {
                    ...state.introAudioState,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case types.GET_CALL_ROUTING_LOGS_REQUEST:
            return Object.assign({}, state, {
                ...state,
                callRoutingLogs: {
                    ...state.callRoutingLogs,
                    error: null,
                    success: false,
                    requesting: true,
                },
            });

        case types.GET_CALL_ROUTING_LOGS_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                callRoutingLogs: {
                    ...state.callRoutingLogs,
                    requesting: false,
                    error: null,
                    success: true,
                    logs: action.payload.logs,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip,
                },
            });

        case types.GET_CALL_ROUTING_LOGS_FAILURE:
            return Object.assign({}, state, {
                ...state,
                callRoutingLogs: {
                    ...state.callRoutingLogs,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case types.GET_CALL_ROUTING_LOGS_RESET:
            return Object.assign({}, state, {
                ...state,
                callRoutingLogs: initialState.callRoutingLogs,
            });

        default:
            return state;
    }
}
