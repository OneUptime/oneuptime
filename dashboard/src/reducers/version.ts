import {
    GET_VERSION_REQUEST,
    GET_VERSION_FAILED,
    GET_VERSION_RESET,
    GET_VERSION_SUCCESS,
} from '../constants/version';

import { version } from '../../package.json';

const initialState = {
    versions: {
        error: null,
        requesting: false,
        success: false,
        server: '',
        client: '',
    },
};

export default (state = initialState, action) => {
    switch (action.type) {
        case GET_VERSION_FAILED:
            return Object.assign({}, state, {
                versions: {
                    ...state.versions,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case GET_VERSION_SUCCESS:
            return Object.assign({}, state, {
                versions: {
                    requesting: false,
                    success: true,
                    error: null,
                    server: action.payload.server,
                    client: version,
                },
            });

        case GET_VERSION_REQUEST:
            return Object.assign({}, state, {
                versions: {
                    ...state.versions,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case GET_VERSION_RESET:
            return Object.assign({}, state, {
                versions: {
                    error: null,
                    requesting: false,
                    success: false,
                    server: '',
                    client: '',
                },
            });

        default:
            return state;
    }
};
