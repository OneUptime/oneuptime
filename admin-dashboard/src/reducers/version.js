import {
    GET_VERSION_REQUEST,
    GET_VERSION_FAILED,
    GET_VERSION_RESET,
    GET_VERSION_SUCCESS,
} from '../constants/version';

const initialState = {
    versions: {
        error: null,
        requesting: false,
        success: false,
        server: '',
        helm: '',
        dashboard: '',
        docs: '',
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
            console.log(action.payload);
            return Object.assign({}, state, {
                versions: {
                    requesting: false,
                    success: true,
                    error: null,
                    server: action.payload.server,
                    helm: action.payload.helm,
                    dashboard: action.payload.dashboard,
                    docs: action.payload.docs,
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
                    helm: '',
                    dashboard: '',
                    docs: '',
                },
            });

        default:
            return state;
    }
};
