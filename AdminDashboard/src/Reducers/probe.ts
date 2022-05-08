import * as types from '../constants/probe';

import Action from 'CommonUI/src/Types/Action';

const initialState: $TSFixMe = {
    probes: {
        requesting: false,
        error: null,
        success: false,
        data: [],
        count: null,
        limit: null,
        skip: null,
    },
    deleteProbe: {
        error: null,
        requesting: false,
        success: false,
    },
    addProbe: {
        error: null,
        requesting: false,
        success: false,
    },
    updateProbe: {
        error: null,
        requesting: false,
        success: false,
    },
};

export default function probes(
    state: $TSFixMe = initialState,
    action: Action
): void {
    switch (action.type) {
        case types.PROBE_SUCCESS:
            return Object.assign({}, state, {
                probes: {
                    requesting: false,
                    error: null,
                    success: true,
                    data: action.payload.data,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip,
                },
            });

        case types.PROBE_REQUEST:
            return Object.assign({}, state, {
                probes: {
                    ...state.probes,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case types.PROBE_FAILED:
            return Object.assign({}, state, {
                probes: {
                    ...state.probes,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case types.PROBE_RESET:
            return Object.assign({}, state, {
                probes: {
                    requesting: false,
                    error: null,
                    success: false,
                    data: [],
                    count: null,
                    limit: null,
                    skip: null,
                },
            });

        case types.DELETE_PROBE_SUCCESS:
            return Object.assign({}, state, {
                probes: {
                    ...state.probes,
                    data: state.probes.data.filter((d: $TSFixMe) => {
                        return d._id !== action.payload;
                    }),

                    count: state.probes.count - 1,
                },
                deleteProbe: {
                    error: null,
                    requesting: false,
                    success: true,
                },
            });

        case types.DELETE_PROBE_REQUEST:
            return Object.assign({}, state, {
                deleteProbe: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });

        case types.DELETE_PROBE_FAILED:
            return Object.assign({}, state, {
                deleteProbe: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case types.DELETE_PROBE_RESET:
            return Object.assign({}, state, {
                deleteProbe: {
                    requesting: false,
                    success: false,
                    error: null,
                },
            });

        case types.ADD_PROBE_SUCCESS:
            return Object.assign({}, state, {
                probes: {
                    ...state.probes,

                    data: state.probes.data.concat([action.payload]),

                    count: state.probes.count + 1,
                },
                addProbe: {
                    error: null,
                    requesting: false,
                    success: true,
                },
            });

        case types.ADD_PROBE_REQUEST:
            return Object.assign({}, state, {
                addProbe: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });

        case types.ADD_PROBE_FAILED:
            return Object.assign({}, state, {
                addProbe: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case types.ADD_PROBE_RESET:
            return Object.assign({}, state, {
                addProbe: {
                    requesting: false,
                    success: false,
                    error: null,
                },
            });

        case types.UPDATE_PROBE_REQUEST:
            return Object.assign({}, state, {
                updateProbe: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });

        case types.UPDATE_PROBE_FAILED:
            return Object.assign({}, state, {
                updateProbe: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case types.UPDATE_PROBE_RESET:
            return Object.assign({}, state, {
                updateProbe: {
                    requesting: false,
                    success: false,
                    error: null,
                },
            });

        case types.UPDATE_PROBE_SUCCESS:
            return Object.assign({}, state, {
                probes: {
                    ...state.probes,

                    data:
                        state.probes.data.length > 0
                            ? state.probes.data.map((probe: $TSFixMe) => {
                                  return probe._id === action.payload._id
                                      ? action.payload
                                      : probe;
                              })
                            : [action.payload],
                },

                updateProbe: {
                    error: null,
                    requesting: false,
                    success: true,
                },
            });

        default:
            return state;
    }
}
