import * as types from '../constants/credential';

const initialState = {
    addGitCredential: { requesting: false, success: false, error: null },
    getGitCredential: { requesting: false, success: false, error: null },
    gitCredentials: [],
    addDockerCredential: { requesting: false, success: false, error: null },
    getDockerCredential: { requesting: false, success: false, error: null },
    dockerCredentials: [],
};

export default function credential(state = initialState, action) {
    switch (action.type) {
        case types.ADD_GIT_CREDENTIAL_REQUEST:
            return {
                ...state,
                addGitCredential: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.ADD_GIT_CREDENTIAL_SUCCESS: {
            const gitCredentials = [action.payload, ...state.gitCredentials];
            return {
                ...state,
                addGitCredential: {
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
                addGitCredential: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.GET_GIT_CREDENTIALS_REQUEST:
            return {
                ...state,
                getGitCredential: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.GET_GIT_CREDENTIALS_SUCCESS:
            return {
                ...state,
                getGitCredential: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                gitCredentials: action.payload,
            };

        case types.GET_GIT_CREDENTIALS_FAILURE:
            return {
                ...state,
                getGitCredential: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.ADD_DOCKER_CREDENTIAL_REQUEST:
            return {
                ...state,
                addDockerCredential: {
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
                addDockerCredential: {
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
                addDockerCredential: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.GET_DOCKER_CREDENTIALS_REQUEST:
            return {
                ...state,
                getDockerCredential: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.GET_DOCKER_CREDENTIALS_SUCCESS:
            return {
                ...state,
                getDockerCredential: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                dockerCredentials: action.payload,
            };

        case types.GET_DOCKER_CREDENTIALS_FAILURE:
            return {
                ...state,
                getDockerCredential: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        default:
            return state;
    }
}
