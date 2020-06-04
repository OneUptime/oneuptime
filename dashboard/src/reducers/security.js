import * as types from '../constants/security';

const initialState = {
    addContainer: { requesting: false, success: false, error: null },
    getContainer: { requesting: false, success: false, error: null },
    deleteContainer: { requesting: false, success: false, error: null },
    containerSecurities: [],
    containerSecurity: {},
    addApplication: { requesting: false, success: false, error: null },
    getApplication: { requesting: false, success: false, error: null },
    deleteApplication: { requesting: false, success: false, error: null },
    applicationSecurities: [],
    applicationSecurity: {},
};

export default function security(state = initialState, action) {
    switch (action.type) {
        case types.ADD_CONTAINER_SECURITY_REQUEST:
            return {
                ...state,
                addContainer: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.ADD_CONTAINER_SECURITY_SUCCESS: {
            const containerSecurities = [
                action.payload,
                ...state.containerSecurities,
            ];

            return {
                ...state,
                addContainer: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                containerSecurities,
            };
        }

        case types.ADD_CONTAINER_SECURITY_FAILURE:
            return {
                ...state,
                addContainer: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.GET_CONTAINER_SECURITY_REQUEST:
            return {
                ...state,
                getContainer: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.GET_CONTAINER_SECURITY_SUCCESS:
            return {
                ...state,
                getContainer: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                containerSecurity: action.payload,
            };

        case types.GET_CONTAINER_SECURITY_FAILURE:
            return {
                ...state,
                getContainer: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.GET_CONTAINER_SECURITIES_REQUEST:
            return {
                ...state,
                getContainer: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.GET_CONTAINER_SECURITIES_SUCCESS:
            return {
                ...state,
                getContainer: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                containerSecurities: action.payload,
            };

        case types.GET_CONTAINER_SECURITIES_FAILURE:
            return {
                ...state,
                getContainer: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.DELETE_CONTAINER_SECURITY_REQUEST:
            return {
                ...state,
                deleteContainer: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.DELETE_CONTAINER_SECURITY_SUCCESS: {
            // update the list of container securities
            const containerSecurities = state.containerSecurities.filter(
                containerSecurity =>
                    String(containerSecurity._id) !== String(action.payload._id)
            );
            return {
                ...state,
                deleteContainer: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                containerSecurities,
            };
        }

        case types.DELETE_CONTAINER_SECURITY_FAILURE:
            return {
                ...state,
                deleteContainer: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.ADD_APPLICATION_SECURITY_REQUEST:
            return {
                ...state,
                addApplication: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.ADD_APPLICATION_SECURITY_SUCCESS: {
            const applicationSecurities = [
                action.payload,
                ...state.applicationSecurities,
            ];

            return {
                ...state,
                addApplication: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                applicationSecurities,
            };
        }

        case types.ADD_APPLICATION_SECURITY_FAILURE:
            return {
                ...state,
                addApplication: {
                    requesting: false,
                    success: true,
                    error: action.payload,
                },
            };

        case types.GET_APPLICATION_SECURITY_REQUEST:
            return {
                ...state,
                getApplication: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.GET_APPLICATION_SECURITY_SUCCESS:
            return {
                ...state,
                getApplication: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                applicationSecurity: action.payload,
            };

        case types.GET_APPLICATION_SECURITY_FAILURE:
            return {
                ...state,
                getApplication: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.GET_APPLICATION_SECURITIES_REQUEST:
            return {
                ...state,
                getApplication: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.GET_APPLICATION_SECURITIES_SUCCESS:
            return {
                ...state,
                getApplication: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                applicationSecurities: action.payload,
            };

        case types.GET_APPLICATION_SECURITIES_FAILURE:
            return {
                ...state,
                getApplication: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.DELETE_APPLICATION_SECURITY_REQUEST:
            return {
                ...state,
                deleteApplication: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.DELETE_APPLICATION_SECURITY_SUCCESS: {
            // update the list of application securities
            const applicationSecurities = state.applicationSecurities.filter(
                applicationSecurity =>
                    String(applicationSecurity._id) !==
                    String(action.payload._id)
            );
            return {
                ...state,
                deleteApplication: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                applicationSecurities,
            };
        }

        case types.DELETE_APPLICATION_SECURITY_FAILURE:
            return {
                ...state,
                deleteApplication: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        default:
            return state;
    }
}
