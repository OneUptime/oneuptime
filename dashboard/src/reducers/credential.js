import * as types from '../constants/credential';

const initialState = {
    addCredential: { requesting: false, success: false, error: null },
    getCredential: { requesting: false, success: false, error: null },
    deleteCredential: { requesting: false, success: false, error: null },
    getSecurities: { requesting: false, success: false, error: null },
    gitCredentials: [],
    gitSecurities: [],
    dockerCredentials: [],
    dockerSecurities: [],
};

export default function credential(state = initialState, action) {
    switch (action.type) {
        case types.ADD_GIT_CREDENTIAL_REQUEST:
            return {
                ...state,
                addCredential: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.ADD_GIT_CREDENTIAL_SUCCESS: {
            const gitCredentials = [action.payload, ...state.gitCredentials];
            return {
                ...state,
                addCredential: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                gitCredentials,
            };
        }

        case types.ADD_GIT_CREDENTIAL_FAILURE:
            return {
                ...state,
                addCredential: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.GET_GIT_CREDENTIALS_REQUEST:
            return {
                ...state,
                getCredential: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.GET_GIT_CREDENTIALS_SUCCESS:
            return {
                ...state,
                getCredential: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                gitCredentials: action.payload,
            };

        case types.GET_GIT_CREDENTIALS_FAILURE:
            return {
                ...state,
                getCredential: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.DELETE_GIT_CREDENTIAL_REQUEST:
            return {
                ...state,
                deleteCredential: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.DELETE_GIT_CREDENTIAL_SUCCESS: {
            // update the list of git credential
            const gitCredentials = state.gitCredentials.filter(
                gitCredential =>
                    String(gitCredential._id) !== String(action.payload._id)
            );

            return {
                ...state,
                deleteCredential: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                gitCredentials,
            };
        }

        case types.DELETE_GIT_CREDENTIAL_FAILURE:
            return {
                ...state,
                deleteCredential: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.GET_GIT_SECURITIES_REQUEST:
            return {
                ...state,
                getSecurities: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.GET_GIT_SECURITIES_SUCCESS:
            return {
                ...state,
                getSecurities: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                gitSecurities: action.payload,
            };

        case types.GET_GIT_SECURITIES_FAILURE:
            return {
                ...state,
                getSecurities: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.ADD_DOCKER_CREDENTIAL_REQUEST:
            return {
                ...state,
                addCredential: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.ADD_DOCKER_CREDENTIAL_SUCCESS: {
            const dockerCredentials = [
                action.payload,
                ...state.dockerCredentials,
            ];
            return {
                ...state,
                addCredential: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                dockerCredentials,
            };
        }

        case types.ADD_DOCKER_CREDENTIAL_FAILURE:
            return {
                ...state,
                addCredential: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.GET_DOCKER_CREDENTIALS_REQUEST:
            return {
                ...state,
                getCredential: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.GET_DOCKER_CREDENTIALS_SUCCESS:
            return {
                ...state,
                getCredential: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                dockerCredentials: action.payload,
            };

        case types.GET_DOCKER_CREDENTIALS_FAILURE:
            return {
                ...state,
                getCredential: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.DELETE_DOCKER_CREDENTIAL_REQUEST:
            return {
                ...state,
                deleteCredential: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.DELETE_DOCKER_CREDENTIAL_SUCCESS: {
            // update the list of git credential
            const dockerCredentials = state.dockerCredentials.filter(
                dockerCredential =>
                    String(dockerCredential._id) !== String(action.payload._id)
            );

            return {
                ...state,
                deleteCredential: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                dockerCredentials,
            };
        }

        case types.DELETE_DOCKER_CREDENTIAL_FAILURE:
            return {
                ...state,
                deleteCredential: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.GET_DOCKER_SECURITIES_REQUEST:
            return {
                ...state,
                getSecurities: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.GET_DOCKER_SECURITIES_SUCCESS:
            return {
                ...state,
                getSecurities: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                dockerSecurities: action.payload,
            };

        case types.GET_DOCKER_SECURITIES_FAILURE:
            return {
                ...state,
                getSecurities: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        default:
            return state;
    }
}
