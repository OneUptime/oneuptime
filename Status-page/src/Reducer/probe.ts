import * as types from '../constants/probe';
import { FETCH_ALL_RESOURCES_SUCCESS } from '../constants/status';

import Action from 'CommonUI/src/types/action';

const INITIAL_STATE = {
    requesting: false,
    error: null,
    success: false,
    probes: [],
    count: null,
    limit: null,
    skip: null,
};

export default function probes(state = INITIAL_STATE, action: Action) {
    switch (action.type) {
        case types.PROBE_SUCCESS:
            return Object.assign({}, state, {
                requesting: false,
                error: null,
                success: true,
                probes: action.payload.data,
                count: action.payload.count,
                limit: action.payload.limit,
                skip: action.payload.skip,
            });

        case types.PROBE_SUCCESS_STATUSPAGE:
            return Object.assign({}, state, {
                requesting: false,
                error: null,
                success: true,
                probes: action.payload.data,
                count: action.payload.count,
                limit: action.payload.limit,
                skip: action.payload.skip,
            });
        case FETCH_ALL_RESOURCES_SUCCESS:
            return Object.assign({}, state, {
                requesting: false,
                error: null,
                success: true,
                probes: action.payload.probes.probes,
                count: action.payload.probes.count,
                limit: 10,
                skip: 0,
            });
        case types.PROBE_REQUEST:
            return Object.assign({}, state, {
                ...state,

                requesting: true,
                error: null,
                success: false,
            });

        case types.PROBE_REQUEST_STATUSPAGE:
            return Object.assign({}, state, {
                ...state,

                requesting: true,
                error: null,
                success: false,
            });

        case types.PROBE_FAILED:
            return Object.assign({}, state, {
                ...state,

                requesting: false,
                error: action.payload,
                success: false,
            });
        case types.PROBE_FAILED_STATUSPAGE:
            return Object.assign({}, state, {
                ...state,

                requesting: false,
                error: action.payload,
                success: false,
            });

        case types.PROBE_RESET:
            return Object.assign({}, state, {
                requesting: false,
                error: null,
                success: false,
                probes: [],
                count: null,
                limit: null,
                skip: null,
            });

        case types.PROBE_RESET_STATUSPAGE:
            return Object.assign({}, state, {
                requesting: false,
                error: null,
                success: false,
                probes: [],
                count: null,
                limit: null,
                skip: null,
            });

        case 'UPDATE_PROBE':
            return Object.assign({}, state, {
                ...state,

                probes:
                    state.probes.length > 0
                        ? state.probes.map(probe => {
                              return probe._id === action.payload._id
                                  ? action.payload
                                  : probe;
                          })
                        : [action.payload],
            });

        default:
            return state;
    }
}
