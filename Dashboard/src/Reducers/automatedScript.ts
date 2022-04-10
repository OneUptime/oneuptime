import {
    FETCH_AUTOMATED_SCRIPT_SUCCESS,
    CREATE_AUTOMATED_SCRIPT_SUCCESS,
    CREATE_AUTOMATED_SCRIPT_FAILURE,
    CREATE_AUTOMATED_SCRIPT_REQUEST,
    RESET_AUTOMATED_SCRIPT,
    FETCH_SINGLE_SCRIPT_SUCCESS,
    FETCH_SINGLE_SCRIPT_REQUEST,
    FETCH_SINGLE_SCRIPT_FAILURE,
    DELETE_AUTOMATED_SCRIPT_SUCCESS,
    DELETE_AUTOMATED_SCRIPT_FAILURE,
    DELETE_AUTOMATED_SCRIPT_REQUEST,
    RUN_AUTOMATED_SCRIPT_REQUEST,
    RUN_AUTOMATED_SCRIPT_FAILURE,
    RUN_AUTOMATED_SCRIPT_SUCCESS,
} from '../constants/automatedScript';

import Action from 'CommonUI/src/types/action';

const INITIAL_STATE = {
    addScripts: {
        requesting: false,
        success: false,
        error: null,
    },
    fetchScripts: {
        scripts: [],
        requesting: false,
        success: false,
        error: null,
    },
    individualScript: {
        log: null,
        requesting: false,
        success: false,
        error: null,
        details: null,
        count: 0,
    },
    deleteScript: {
        requesting: false,
        success: false,
        error: null,
    },
    runScript: {
        requesting: false,
        success: false,
        error: null,
    },
};

export default function component(state = INITIAL_STATE, action: Action) {
    switch (action.type) {
        case RESET_AUTOMATED_SCRIPT:
            return Object.assign({}, state, {
                addScripts: {
                    ...state.addScripts,
                    requesting: false,
                    error: null,
                    success: false,
                },
            });
        case CREATE_AUTOMATED_SCRIPT_FAILURE:
            return Object.assign({}, state, {
                addScripts: {
                    ...state.addScripts,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });
        case CREATE_AUTOMATED_SCRIPT_REQUEST:
            return Object.assign({}, state, {
                addScripts: {
                    ...state.addScripts,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case CREATE_AUTOMATED_SCRIPT_SUCCESS:
            return Object.assign({}, state, {
                addScripts: {
                    ...state.addScripts,
                    requesting: false,
                    error: null,
                    success: true,
                },
            });

        case FETCH_AUTOMATED_SCRIPT_SUCCESS:
            return Object.assign({}, state, {
                fetchScripts: {
                    ...state.fetchScripts,
                    scripts: action.payload.data,
                    count: action.payload.count,
                    skip: action.payload.skip,
                    limit: action.payload.limit,
                    requesting: false,
                    error: null,
                    success: true,
                },
            });

        case FETCH_SINGLE_SCRIPT_SUCCESS:
            return Object.assign({}, state, {
                individualScript: {
                    log: action.payload.data.logs,
                    skip: action.payload.skip,
                    limit: action.payload.limit,
                    count: action.payload.count,
                    requesting: false,
                    success: true,
                    error: null,
                    details: action.payload.data.details,
                },
            });

        case FETCH_SINGLE_SCRIPT_FAILURE:
            return Object.assign({}, state, {
                individualScript: {
                    log: null,
                    requesting: false,
                    success: false,
                    error: action.payload,
                    details: null,
                },
            });

        case FETCH_SINGLE_SCRIPT_REQUEST:
            return Object.assign({}, state, {
                individualScript: {
                    log: null,
                    requesting: true,
                    success: false,
                    error: null,
                    details: null,
                },
            });

        case DELETE_AUTOMATED_SCRIPT_SUCCESS:
            return Object.assign({}, state, {
                deleteScript: {
                    ...state.deleteScript,
                    requesting: false,
                    success: true,
                    error: null,
                },
            });

        case DELETE_AUTOMATED_SCRIPT_REQUEST:
            return Object.assign({}, state, {
                deleteScript: {
                    ...state.deleteScript,
                    requesting: true,
                    success: false,
                    error: null,
                },
            });

        case DELETE_AUTOMATED_SCRIPT_FAILURE:
            return Object.assign({}, state, {
                deleteScript: {
                    ...state.deleteScript,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case RUN_AUTOMATED_SCRIPT_FAILURE:
            return Object.assign({}, state, {
                runScript: {
                    ...state.runScript,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case RUN_AUTOMATED_SCRIPT_REQUEST:
            return Object.assign({}, state, {
                runScript: {
                    ...state.runScript,
                    requesting: true,
                    success: false,
                    error: null,
                },
            });

        case RUN_AUTOMATED_SCRIPT_SUCCESS:
            return Object.assign({}, state, {
                runScript: {
                    ...state.runScript,
                    requesting: false,
                    success: true,
                    error: null,
                },
            });

        default:
            return state;
    }
}
