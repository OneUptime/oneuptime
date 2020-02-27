import * as types from '../constants/probe';

const initialState = {
    probes: {
        requesting: false,
        error: null,
        success: false,
        data: [],
        count: null,
        limit: null,
        skip: null,
    },
};

export default function probes(state = initialState, action) {
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
                    requesting: true,
                    error: null,
                    success: false,
                    data: state.probes.data,
                    count: state.probes.count,
                    limit: state.probes.limit,
                    skip: state.probes.skip,
                },
            });

        case types.PROBE_FAILED:
            return Object.assign({}, state, {
                probes: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    data: state.probes.data,
                    count: state.probes.count,
                    limit: state.probes.limit,
                    skip: state.probes.skip,
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

        case 'UPDATE_PROBE':
            return Object.assign({}, state, {
                probes: {
                    ...state.probes,

                    data:
                        state.probes.data.length > 0
                            ? state.probes.data.map(probe => {
                                  return probe._id === action.payload._id
                                      ? action.payload
                                      : probe;
                              })
                            : [action.payload],
                },
            });

        default:
            return state;
    }
}
