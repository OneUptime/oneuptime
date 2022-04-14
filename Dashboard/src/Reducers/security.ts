import * as types from '../constants/security';

import Action from 'CommonUI/src/types/action';

const initialState: $TSFixMe = {
    addContainer: { requesting: false, success: false, error: null },
    getContainer: { requesting: false, success: false, error: null },
    deleteContainer: { requesting: false, success: false, error: null },
    scanContainerSecurity: { requesting: false, success: false, error: null },
    getContainerSecurityLog: { requesting: false, success: false, error: null },
    editContainerSecurity: { requesting: false, success: false, error: null },
    containerSecurities: {
        securities: [],
        skip: 0,
        limit: 0,
        count: 0,
        fetchingPage: false,
    },
    containerSecurity: {},
    containerSecurityLog: {},
    containerSecurityLogs: [],
    activeContainerSecurity: '',
    addApplication: { requesting: false, success: false, error: null },
    getApplication: { requesting: false, success: false, error: null },
    deleteApplication: { requesting: false, success: false, error: null },
    scanApplicationSecurity: { requesting: false, success: false, error: null },
    getApplicationSecurityLog: {
        requesting: false,
        success: false,
        error: null,
    },
    editApplicationSecurity: { requesting: false, success: false, error: null },
    applicationSecurities: {
        securities: [],
        skip: 0,
        limit: 0,
        count: 0,
        fetchingPage: false,
    },
    applicationSecurity: {},
    applicationSecurityLog: {},
    applicationSecurityLogs: [],
    activeApplicationSecurity: '',
};

export default function security(state = initialState, action: Action): void {
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
            return {
                ...state,
                addContainer: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                containerSecurities: {
                    ...state.containerSecurities,
                    securities: [
                        action.payload,
                        ...state.containerSecurities.securities,
                    ],
                },
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

        case types.GET_CONTAINER_SECURITY_SUCCESS: {
            const securities: $TSFixMe =
                state.containerSecurities.securities.length > 0
                    ? state.containerSecurities.securities.map(
                          containerSecurity => {
                              if (
                                  String(containerSecurity._id) ===
                                  String(action.payload._id)
                              ) {
                                  containerSecurity = action.payload;
                              }
                              return containerSecurity;
                          }
                      )
                    : [action.payload];
            return {
                ...state,
                getContainer: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                containerSecurity: action.payload,
                containerSecurities: {
                    ...state.containerSecurities,
                    securities,
                },
            };
        }

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
                    requesting: action.payload ? false : true,
                    success: false,
                    error: null,
                },
                containerSecurities: {
                    ...state.containerSecurities,
                    fetchingPage: true,
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
                containerSecurities: {
                    securities: action.payload.data,
                    count: action.payload.count,
                    skip: action.payload.skip,
                    limit: action.payload.limit,
                    fetchingPage: false,
                },
            };

        case types.GET_CONTAINER_SECURITIES_FAILURE:
            return {
                ...state,
                getContainer: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
                containerSecurities: {
                    ...state.containerSecurities,
                    fetchingPage: false,
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
            const securities: $TSFixMe =
                state.containerSecurities.securities.filter(
                    containerSecurity =>
                        String(containerSecurity._id) !==
                        String(action.payload._id)
                );
            const count: $TSFixMe =
                state.containerSecurities.count === 0
                    ? 0
                    : state.containerSecurities.count - 1;
            return {
                ...state,
                deleteContainer: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                containerSecurities: {
                    ...state.containerSecurities,
                    securities,
                    count,
                },
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

        case types.SCAN_CONTAINER_SECURITY_REQUEST:
            return {
                ...state,
                scanContainerSecurity: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.SCAN_CONTAINER_SECURITY_SUCCESS: {
            const containerSecurityLogs: $TSFixMe = [
                ...state.containerSecurityLogs,
                action.payload,
            ];
            return {
                ...state,
                scanContainerSecurity: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                containerSecurityLog: action.payload,
                containerSecurityLogs,
            };
        }

        case types.SCAN_CONTAINER_SECURITY_FAILURE:
            return {
                ...state,
                scanContainerSecurity: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.GET_CONTAINER_SECURITY_LOG_REQUEST:
            return {
                ...state,
                getContainerSecurityLog: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.GET_CONTAINER_SECURITY_LOG_SUCCESS:
            return {
                ...state,
                getContainerSecurityLog: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                containerSecurityLog: action.payload,
            };

        case types.GET_CONTAINER_SECURITY_LOG_FAILURE:
            return {
                ...state,
                getContainerSecurityLog: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.GET_CONTAINER_SECURITY_LOGS_REQUEST:
            return {
                ...state,
                getContainerSecurityLog: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.GET_CONTAINER_SECURITY_LOGS_SUCCESS:
            return {
                ...state,
                getContainerSecurityLog: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                containerSecurityLogs: action.payload,
            };

        case types.GET_CONTAINER_SECURITY_LOGS_FAILURE:
            return {
                ...state,
                getContainerSecurityLog: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.EDIT_CONTAINER_SECURITY_REQUEST:
            return {
                ...state,
                editContainerSecurity: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.EDIT_CONTAINER_SECURITY_SUCCESS:
            return {
                ...state,
                editContainerSecurity: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                containerSecurity: action.payload,
            };

        case types.EDIT_CONTAINER_SECURITY_FAILURE:
            return {
                ...state,
                editContainerSecurity: {
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
            return {
                ...state,
                addApplication: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                applicationSecurities: {
                    ...state.applicationSecurities,
                    securities: [
                        action.payload,
                        ...state.applicationSecurities.securities,
                    ],
                },
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

        case types.GET_APPLICATION_SECURITY_SUCCESS: {
            const securities: $TSFixMe =
                state.applicationSecurities.securities.length > 0
                    ? state.applicationSecurities.securities.map(
                          applicationSecurity => {
                              if (
                                  String(applicationSecurity._id) ===
                                  String(action.payload._id)
                              ) {
                                  applicationSecurity = action.payload;
                              }
                              return applicationSecurity;
                          }
                      )
                    : [action.payload];
            return {
                ...state,
                getApplication: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                applicationSecurity: action.payload,
                applicationSecurities: {
                    ...state.applicationSecurities,
                    securities,
                },
            };
        }

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
                    requesting: action.payload ? false : true,
                    success: false,
                    error: null,
                },
                applicationSecurities: {
                    ...state.applicationSecurities,
                    fetchingPage: true,
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
                applicationSecurities: {
                    securities: action.payload.data,
                    skip: action.payload.skip,
                    limit: action.payload.limit,
                    count: action.payload.count,
                    fetchingPage: false,
                },
            };

        case types.GET_APPLICATION_SECURITIES_FAILURE:
            return {
                ...state,
                getApplication: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
                applicationSecurities: {
                    ...state.applicationSecurities,
                    fetchingPage: false,
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
            const securities: $TSFixMe =
                state.applicationSecurities.securities.filter(
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
                applicationSecurities: {
                    ...state.applicationSecurities,
                    securities,
                },
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

        case types.SCAN_APPLICATION_SECURITY_REQUEST:
            return {
                ...state,
                scanApplicationSecurity: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.SCAN_APPLICATION_SECURITY_SUCCESS: {
            const applicationSecurityLogs: $TSFixMe = [
                ...state.applicationSecurityLogs,
                action.payload,
            ];
            return {
                ...state,
                scanApplicationSecurity: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                applicationSecurityLog: action.payload,
                applicationSecurityLogs,
            };
        }

        case types.SCAN_APPLICATION_SECURITY_FAILURE:
            return {
                ...state,
                scanApplicationSecurity: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.GET_APPLICATION_SECURITY_LOG_REQUEST:
            return {
                ...state,
                getApplicationSecurityLog: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.GET_APPLICATION_SECURITY_LOG_SUCCESS:
            return {
                ...state,
                getApplicationSecurityLog: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                applicationSecurityLog: action.payload,
            };

        case types.GET_APPLICATION_SECURITY_LOG_FAILURE:
            return {
                ...state,
                getApplicationSecurityLog: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.GET_APPLICATION_SECURITY_LOGS_REQUEST:
            return {
                ...state,
                getApplicationSecurityLog: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.GET_APPLICATION_SECURITY_LOGS_SUCCESS:
            return {
                ...state,
                getApplicationSecurityLog: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                applicationSecurityLogs: action.payload,
            };

        case types.GET_APPLICATION_SECURITY_LOGS_FAILURE:
            return {
                ...state,
                getApplicationSecurityLog: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.EDIT_APPLICATION_SECURITY_REQUEST:
            return {
                ...state,
                editApplicationSecurity: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.EDIT_APPLICATION_SECURITY_SUCCESS:
            return {
                ...state,
                editApplicationSecurity: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                applicationSecurity: action.payload,
            };

        case types.EDIT_APPLICATION_SECURITY_FAILURE:
            return {
                ...state,
                editApplicationSecurity: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.SET_ACTIVE_APPLICATION_SECURITY:
            return {
                ...state,
                activeApplicationSecurity: action.payload,
            };

        case types.SET_ACTIVE_CONTAINER_SECURITY:
            return {
                ...state,
                activeContainerSecurity: action.payload,
            };

        default:
            return state;
    }
}
