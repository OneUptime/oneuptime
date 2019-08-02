import {
    GET_WEB_HOOK_REQUEST,
    GET_WEB_HOOK_FAILED,
    GET_WEB_HOOK_RESET,
    GET_WEB_HOOK_SUCCESS,
    DELETE_WEB_HOOK_FAILED,
    DELETE_WEB_HOOK_REQUEST,
    DELETE_WEB_HOOK_RESET,
    DELETE_WEB_HOOK_SUCCESS,
    CREATE_WEB_HOOK_FAILED,
    CREATE_WEB_HOOK_REQUEST,
    CREATE_WEB_HOOK_RESET,
    CREATE_WEB_HOOK_SUCCESS,
    UPDATE_WEB_HOOK_REQUEST,
    UPDATE_WEB_HOOK_FAILED,
    UPDATE_WEB_HOOK_SUCCESS,
    UPDATE_WEB_HOOK_RESET,
    PAGINATE_PREV,
    PAGINATE_NEXT,
    PAGINATE_RESET
} from '../constants/webHook';

const initialState = {
    webHook:{
        error:null,
        requesting: false,
        success:false,
        webHooks:[],
        count: null,
        limit: null,
        skip: null
    },
    deleteWebHook: {
        error:null,
        requesting: false,
        success:false,
    },
    createWebHook: {
        error:null,
        requesting: false,
        success:false,
    },
    updateWebHook: {
        error:null,
        requesting: false,
        success:false,
    },
    pages: {
		counter: 0
	}
};

export default (state = initialState, action) => {
    let webHooks, index, count;
    switch (action.type) {

        case GET_WEB_HOOK_FAILED:
            return Object.assign({}, state, {
                webHook: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    webHooks : [],
                    count: null,
                    limit: null,
                    skip: null
                },
            });

        case GET_WEB_HOOK_SUCCESS:
            return Object.assign({}, state, {
                webHook: {
                    requesting: false,
                    success: true,
                    error: null,
                    webHooks: action.payload.data,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip
                }
            });

        case GET_WEB_HOOK_REQUEST:
            return Object.assign({}, state, {
                webHook: {
                    requesting: true,
                    error: null,
                    success: false,
                    webHooks:[],
                    count: null,
                    limit: null,
                    skip: null
                },
            });

        case GET_WEB_HOOK_RESET:
            return Object.assign({}, state, {
                webHook:{
                    error:null,
                    requesting: false,
                    success:false,
                    webHooks:[],
                    count: null,
                    limit: null,
                    skip: null
                }
            });

        case DELETE_WEB_HOOK_FAILED:
            return Object.assign({}, state, {
                deleteWebHook: {
                    requesting: false,
                    error: action.payload,
                    success: false
                },
            });

        case DELETE_WEB_HOOK_SUCCESS:

            webHooks = Object.assign([], state.webHook.webHooks);
            index = webHooks.findIndex(team => team._id === action.payload._id);
            webHooks.splice(index, 1);
            count = state.webHook.count - 1;
            return Object.assign({}, state, {
                deleteWebHook: {
                    requesting: false,
                    success: true,
                    error: null
                },
                webHook: {
                    requesting: false,
                    success: true,
                    error: null,
                    webHooks,
                    skip: state.webHook.skip,
                    limit: state.webHook.limit,
                    count: count
                }
            });

        case DELETE_WEB_HOOK_REQUEST:
            return Object.assign({}, state, {
                deleteWebHook: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case DELETE_WEB_HOOK_RESET:
            return Object.assign({}, state, {
                deleteWebHook:{
                    error:null,
                    requesting: false,
                    success:false
                }
            });

        case CREATE_WEB_HOOK_FAILED:
            return Object.assign({}, state, {
                createWebHook: {
                    requesting: false,
                    error: action.payload,
                    success: false
                },
            });

        case CREATE_WEB_HOOK_SUCCESS:
            webHooks = Object.assign([], state.webHook.webHooks);
            action.payload._id && webHooks.push(action.payload);
            count = state.webHook.count + 1;

            return Object.assign({}, state, {
                createWebHook: {
                    requesting: false,
                    success: true,
                    error: null
                },
                webHook: {
                    requesting: false,
                    success: true,
                    error: null,
                    webHooks,
                    skip: state.webHook.skip,
                    limit: state.webHook.limit,
                    count: count
                }
            });

        case CREATE_WEB_HOOK_REQUEST:
            return Object.assign({}, state, {
                createWebHook: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case CREATE_WEB_HOOK_RESET:
            return Object.assign({}, state, {
                createWebHook:{
                    error:null,
                    requesting: false,
                    success:false
                }
            });

        case UPDATE_WEB_HOOK_FAILED:
            return Object.assign({}, state, {
               updateWebHook: {
                    requesting: false,
                    error: action.payload,
                    success: false
                },
            });

        case UPDATE_WEB_HOOK_SUCCESS:

            webHooks = Object.assign([], state.webHook.webHooks);
            index = webHooks.findIndex(hook => hook._id === action.payload._id);
            webHooks[index] = action.payload;

            return Object.assign({}, state, {
                updateWebHook: {
                    requesting: false,
                    success: true,
                    error: null
                },
                webHook: {
                    requesting: false,
                    success: true,
                    error: null,
                    webHooks,
                    skip: state.webHook.skip,
                    limit: state.webHook.limit,
                    count: state.webHook.count
                }
            });

        case UPDATE_WEB_HOOK_REQUEST:
            return Object.assign({}, state, {
                updateWebHook: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case UPDATE_WEB_HOOK_RESET:
            return Object.assign({}, state, {
                createWebHook:{
                    error:null,
                    requesting: false,
                    success:false
                }
            });

        case PAGINATE_NEXT:
			return {
				...state,
				pages: {
					counter: state.pages.counter + 1
				}
			}

		case PAGINATE_PREV:
			return {
				...state,
				pages: {
					counter: state.pages.counter - 1
				}
			}

		case PAGINATE_RESET:
			return {
				...state,
				pages: {
					counter: 0
				}
			}
        default: return state;
    }
}