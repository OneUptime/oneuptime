import {
    FETCH_INCIDENT_PRIORITIES_REQUEST,
    FETCH_INCIDENT_PRIORITIES_SUCCESS,
    FETCH_INCIDENT_PRIORITIES_FAILURE,
    FETCH_INCIDENT_PRIORITIES_RESET,
    CREATE_INCIDENT_PRIORITY_REQUEST,
    CREATE_INCIDENT_PRIORITY_SUCCESS,
    CREATE_INCIDENT_PRIORITY_FAILURE,
    CREATE_INCIDENT_PRIORITY_RESET,
    UPDATE_INCIDENT_PRIORITY_REQUEST,
    UPDATE_INCIDENT_PRIORITY_SUCCESS,
    UPDATE_INCIDENT_PRIORITY_FAILURE,
    UPDATE_INCIDENT_PRIORITY_RESET,
    DELETE_INCIDENT_PRIORITY_REQUEST,
    DELETE_INCIDENT_PRIORITY_SUCCESS,
    DELETE_INCIDENT_PRIORITY_FAILURE,
    DELETE_INCIDENT_PRIORITY_RESET,
} from '../constants/incidentPriorities';

const INITIAL_STATE = {
    incidentPrioritiesList: {
        error: null,
        requesting: false,
        success: false,
        incidentPriorities: [],
        count: null,
        limit: 10,
        skip: 0,
    },
    newIncidentPriority: {
        error: null,
        requesting: false,
        success: false,
    },
    editIncidentPriority: {
        error: null,
        requesting: false,
        success: false,
    },
    deleteIncidentPriority: {
        error: null,
        requesting: false,
        success: false,
    },
};

export default (state = INITIAL_STATE, action: $TSFixMe) => {
    let incidentPriorities, count, index;
    switch (action.type) {
        case FETCH_INCIDENT_PRIORITIES_SUCCESS:
            return Object.assign({}, state, {
                incidentPrioritiesList: {
                    ...state.incidentPrioritiesList,
                    error: null,
                    success: true,
                    requesting: false,
                    incidentPriorities: action.payload.data,
                    skip: action.payload.skip,
                    limit: action.payload.limit,
                    count: action.payload.count,
                },
            });
        case FETCH_INCIDENT_PRIORITIES_REQUEST:
            return Object.assign({}, state, {
                incidentPrioritiesList: {
                    ...state.incidentPrioritiesList,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });
        case FETCH_INCIDENT_PRIORITIES_FAILURE:
            return Object.assign({}, state, {
                incidentPrioritiesList: {
                    ...state.incidentPrioritiesList,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });
        case FETCH_INCIDENT_PRIORITIES_RESET:
            return Object.assign({}, state, {
                incidentPrioritiesList: {
                    ...INITIAL_STATE.incidentPrioritiesList,
                },
            });

        case CREATE_INCIDENT_PRIORITY_REQUEST:
            return Object.assign({}, state, {
                newIncidentPriority: {
                    ...state.newIncidentPriority,
                    error: null,
                    requesting: true,
                    success: false,
                },
            });

        case CREATE_INCIDENT_PRIORITY_SUCCESS:
            incidentPriorities = Object.assign(
                [],
                state.incidentPrioritiesList.incidentPriorities
            );
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'any' is not assignable to parame... Remove this comment to see the full error message
            incidentPriorities.push(action.payload);
            // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
            count = state.incidentPrioritiesList.count + 1;
            return Object.assign({}, state, {
                incidentPrioritiesList: {
                    ...state.incidentPrioritiesList,
                    incidentPriorities,
                    count,
                },
                newIncidentPriority: {
                    ...state.newIncidentPriority,
                    error: null,
                    requesting: false,
                    success: true,
                },
            });

        case CREATE_INCIDENT_PRIORITY_FAILURE:
            return Object.assign({}, state, {
                newIncidentPriority: {
                    ...state.newIncidentPriority,
                    error: action.payload,
                    requesting: false,
                    success: false,
                },
            });

        case CREATE_INCIDENT_PRIORITY_RESET:
            return Object.assign({}, state, {
                newIncidentPriority: {
                    ...state.newIncidentPriority,
                    error: null,
                    requesting: false,
                    success: false,
                },
            });

        case UPDATE_INCIDENT_PRIORITY_REQUEST:
            return Object.assign({}, state, {
                editIncidentPriority: {
                    ...state.editIncidentPriority,
                    error: null,
                    requesting: true,
                    success: false,
                },
            });

        case UPDATE_INCIDENT_PRIORITY_SUCCESS:
            incidentPriorities = Object.assign(
                [],
                state.incidentPrioritiesList.incidentPriorities
            );
            index = incidentPriorities.findIndex(
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                incidentPriority => incidentPriority._id === action.payload._id
            );
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'any' is not assignable to type 'never'.
            incidentPriorities[index] = action.payload;

            return Object.assign({}, state, {
                incidentPrioritiesList: {
                    ...state.incidentPrioritiesList,
                    incidentPriorities,
                },
                editIncidentPriority: {
                    ...state.editIncidentPriority,
                    error: null,
                    requesting: false,
                    success: true,
                },
            });

        case UPDATE_INCIDENT_PRIORITY_FAILURE:
            return Object.assign({}, state, {
                editIncidentPriority: {
                    ...state.editIncidentPriority,
                    error: action.payload,
                    requesting: false,
                    success: false,
                },
            });

        case UPDATE_INCIDENT_PRIORITY_RESET:
            return Object.assign({}, state, {
                editIncidentPriority: {
                    ...state.editIncidentPriority,
                    error: null,
                    requesting: false,
                    success: false,
                },
            });

        case DELETE_INCIDENT_PRIORITY_REQUEST:
            return Object.assign({}, state, {
                deleteIncidentPriority: {
                    ...state.deleteIncidentPriority,
                    error: null,
                    requesting: true,
                    success: false,
                },
            });

        case DELETE_INCIDENT_PRIORITY_SUCCESS:
            incidentPriorities = Object.assign(
                [],
                state.incidentPrioritiesList.incidentPriorities
            );
            index = incidentPriorities.findIndex(
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                incidentPriority => incidentPriority._id === action.payload._id
            );
            incidentPriorities.splice(index, 1);
            // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
            count = state.incidentPrioritiesList.count - 1;

            return Object.assign({}, state, {
                incidentPrioritiesList: {
                    ...state.incidentPrioritiesList,
                    incidentPriorities,
                    count,
                },
                deleteIncidentPriority: {
                    ...state.deleteIncidentPriority,
                    error: null,
                    requesting: false,
                    success: true,
                },
            });

        case DELETE_INCIDENT_PRIORITY_FAILURE:
            return Object.assign({}, state, {
                deleteIncidentPriority: {
                    ...state.deleteIncidentPriority,
                    error: action.payload,
                    requesting: false,
                    success: false,
                },
            });

        case DELETE_INCIDENT_PRIORITY_RESET:
            return Object.assign({}, state, {
                deleteIncidentPriority: {
                    ...state.deleteIncidentPriority,
                    error: null,
                    requesting: false,
                    success: false,
                },
            });

        default:
            return state;
    }
};
