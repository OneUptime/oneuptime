import * as types from '../constants/incomingRequest';

import Action from 'CommonUI/src/types/action';

const initialState = {
    incomingRequests: {
        requesting: false,
        success: false,
        error: null,
        incomingRequests: [],
        count: 0,
        skip: 0,
        limit: 10,
    },
    updateIncomingRequest: {
        requesting: false,
        success: false,
        error: null,
        incomingRequest: null,
    },
    deleteIncomingRequest: {
        requesting: false,
        success: false,
        error: null,
    },
    createIncomingRequest: {
        requesting: false,
        success: false,
        error: null,
        incomingRequest: null,
    },
    activeIncomingRequest: '',
};

export default function incomingRequest(
    state = initialState,
    action: Action
): void {
    switch (action.type) {
        case types.FETCH_ALL_INCOMING_REQUEST_REQUEST:
            return {
                ...state,
                incomingRequests: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.FETCH_ALL_INCOMING_REQUEST_SUCCESS:
            return {
                ...state,
                incomingRequests: {
                    requesting: false,
                    success: true,
                    error: null,
                    incomingRequests: action.payload.data,
                    skip: action.payload.skip,
                    limit: action.payload.limit,
                    count: action.payload.count,
                },
            };

        case types.FETCH_ALL_INCOMING_REQUEST_FAILURE:
            return {
                ...state,
                incomingRequests: {
                    ...state.incomingRequests,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.CREATE_INCOMING_REQUEST_REQUEST:
            return {
                ...state,
                createIncomingRequest: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.CREATE_INCOMING_REQUEST_SUCCESS: {
            let incomingRequests = [...state.incomingRequests.incomingRequests];
            if (action.payload.isDefault) {
                incomingRequests = incomingRequests.map(request => {
                    if (request.isDefault) {
                        request.isDefault = false;
                    }
                    return request;
                });
            }
            return {
                ...state,
                createIncomingRequest: {
                    requesting: false,
                    success: true,
                    error: null,
                    incomingRequest: action.payload,
                },
                incomingRequests: {
                    ...state.incomingRequests,
                    incomingRequests: [action.payload, ...incomingRequests],
                    count: state.incomingRequests.count + 1,
                },
            };
        }

        case types.CREATE_INCOMING_REQUEST_FAILURE:
            return {
                ...state,
                createIncomingRequest: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.EDIT_INCOMING_REQUEST_REQUEST:
            return {
                ...state,
                updateIncomingRequest: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.EDIT_INCOMING_REQUEST_SUCCESS: {
            let incomingRequests = [...state.incomingRequests.incomingRequests];
            if (action.payload.isDefault) {
                incomingRequests = incomingRequests.map(request => {
                    if (request.isDefault) {
                        request.isDefault = false;
                    }
                    return request;
                });
            }

            incomingRequests = incomingRequests.map(request => {
                if (String(request._id) === String(action.payload._id)) {
                    request = action.payload;
                }
                return request;
            });

            return {
                ...state,
                updateIncomingRequest: {
                    requesting: false,
                    success: true,
                    error: null,
                    incomingRequest: action.payload,
                },
                incomingRequests: {
                    ...state.incomingRequests,
                    incomingRequests,
                },
            };
        }

        case types.EDIT_INCOMING_REQUEST_FAILURE:
            return {
                ...state,
                updateIncomingRequest: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.DELETE_INCOMING_REQUEST_REQUEST:
            return {
                ...state,
                deleteIncomingRequest: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.DELETE_INCOMING_REQUEST_SUCCESS: {
            const incomingRequests =
                state.incomingRequests.incomingRequests.filter(
                    request =>
                        String(request._id) !== String(action.payload._id)
                );
            return {
                ...state,
                deleteIncomingRequest: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                incomingRequests: {
                    ...state.incomingRequests,
                    incomingRequests,
                    count: state.incomingRequests.count - 1,
                },
            };
        }

        case types.DELETE_INCOMING_REQUEST_FAILURE:
            return {
                ...state,
                deleteIncomingRequest: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.SET_ACTIVE_INCOMING_REQUEST:
            return {
                ...state,
                activeIncomingRequest: action.payload,
            };

        default:
            return state;
    }
}
