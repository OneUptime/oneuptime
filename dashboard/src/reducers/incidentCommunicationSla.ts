import * as types from '../constants/incidentCommunicationSla';

const initialState = {
    incidentCommunicationSla: {
        requesting: false,
        success: false,
        error: null,
        incidentSla: [],
    },
    defaultIncidentCommunicationSla: {
        requesting: false,
        success: false,
        error: null,
        sla: null,
    },
    incidentCommunicationSlas: {
        requesting: false,
        success: false,
        error: null,
        incidentSlas: [],
        count: 0,
        skip: 0,
        limit: 10,
    },
    activeSla: '',
};

export default function incidentCommunicationSla(
    state = initialState,
    action: $TSFixMe
) {
    switch (action.type) {
        case types.CREATE_COMMUNICATION_SLA_REQUEST:
            return {
                ...state,
                incidentCommunicationSla: {
                    ...state.incidentCommunicationSla,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.CREATE_COMMUNICATION_SLA_SUCCESS:
            return {
                ...state,
                incidentCommunicationSla: {
                    requesting: false,
                    success: true,
                    error: null,
                    incidentSla: action.payload,
                },
            };

        case types.CREATE_COMMUNICATION_SLA_FAILURE:
            return {
                ...state,
                incidentCommunicationSla: {
                    ...state.incidentCommunicationSla,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.DELETE_COMMUNICATION_SLA_REQUEST:
            return {
                ...state,
                incidentCommunicationSlas: {
                    ...state.incidentCommunicationSlas,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.DELETE_COMMUNICATION_SLA_SUCCESS: {
            const incidentSlas = state.incidentCommunicationSlas.incidentSlas.filter(
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                sla => String(sla._id) !== String(action.payload._id)
            );
            return {
                ...state,
                incidentCommunicationSlas: {
                    ...state.incidentCommunicationSlas,
                    requesting: false,
                    success: true,
                    error: null,
                    incidentSlas,
                    count: state.incidentCommunicationSlas.count - 1,
                },
            };
        }

        case types.DELETE_COMMUNICATION_SLA_FAILURE:
            return {
                ...state,
                incidentCommunicationSlas: {
                    ...state.incidentCommunicationSlas,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.FETCH_COMMUNICATION_SLAS_REQUEST:
            return {
                ...state,
                incidentCommunicationSlas: {
                    ...state.incidentCommunicationSlas,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.FETCH_COMMUNICATION_SLAS_SUCCESS:
            return {
                ...state,
                incidentCommunicationSlas: {
                    requesting: false,
                    success: true,
                    error: null,
                    incidentSlas: action.payload.data,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip,
                },
            };

        case types.FETCH_COMMUNICATION_SLAS_FAILURE:
            return {
                ...state,
                incidentCommunicationSlas: {
                    ...state.incidentCommunicationSlas,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.FETCH_DEFAULT_COMMUNICATION_SLA_REQUEST:
            return {
                ...state,
                defaultIncidentCommunicationSla: {
                    ...state.defaultIncidentCommunicationSla,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.FETCH_DEFAULT_COMMUNICATION_SLA_SUCCESS:
            return {
                ...state,
                defaultIncidentCommunicationSla: {
                    requesting: false,
                    success: true,
                    error: null,
                    sla: action.payload,
                },
            };

        case types.FETCH_DEFAULT_COMMUNICATION_SLA_FAILURE:
            return {
                ...state,
                defaultIncidentCommunicationSla: {
                    ...state.defaultIncidentCommunicationSla,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.UPDATE_COMMUNICATION_SLA_REQUEST:
            return {
                ...state,
                incidentCommunicationSlas: {
                    ...state.incidentCommunicationSlas,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.UPDATE_COMMUNICATION_SLA_SUCCESS: {
            const incidentSlas = state.incidentCommunicationSlas.incidentSlas.map(
                sla => {
                    if (
                        action.payload.isDefault &&
                        // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                        String(sla._id) !== String(action.payload._id)
                    ) {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isDefault' does not exist on type 'never... Remove this comment to see the full error message
                        sla.isDefault = false;
                    }

                    // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                    if (String(sla._id) === String(action.payload._id)) {
                        // @ts-expect-error ts-migrate(2322) FIXME: Type 'any' is not assignable to type 'never'.
                        sla = action.payload;
                    }

                    return sla;
                }
            );
            return {
                ...state,
                incidentCommunicationSlas: {
                    ...state.incidentCommunicationSlas,
                    requesting: false,
                    success: true,
                    error: null,
                    incidentSlas,
                },
            };
        }

        case types.UPDATE_COMMUNICATION_SLA_FAILURE:
            return {
                ...state,
                incidentCommunicationSlas: {
                    ...state.incidentCommunicationSlas,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.SET_ACTIVE_SLA:
            return {
                ...state,
                activeSla: action.payload,
            };

        default:
            return state;
    }
}
