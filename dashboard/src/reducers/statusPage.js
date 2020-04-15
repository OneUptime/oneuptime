import {
    CREATE_STATUSPAGE_REQUEST,
    CREATE_STATUSPAGE_SUCCESS,
    CREATE_STATUSPAGE_FAILURE,
    CREATE_STATUSPAGE_RESET,
    UPDATE_STATUSPAGE_SETTING_REQUEST,
    UPDATE_STATUSPAGE_SETTING_SUCCESS,
    UPDATE_STATUSPAGE_SETTING_FAILURE,
    UPDATE_STATUSPAGE_SETTING_RESET,
    UPDATE_STATUSPAGE_MONITORS_REQUEST,
    UPDATE_STATUSPAGE_MONITORS_SUCCESS,
    UPDATE_STATUSPAGE_MONITORS_FAILURE,
    UPDATE_STATUSPAGE_MONITORS_RESET,
    UPDATE_PRIVATE_STATUSPAGE_REQUEST,
    UPDATE_PRIVATE_STATUSPAGE_SUCCESS,
    UPDATE_PRIVATE_STATUSPAGE_FAILURE,
    UPDATE_PRIVATE_STATUSPAGE_RESET,
    UPDATE_STATUSPAGE_BRANDING_REQUEST,
    UPDATE_STATUSPAGE_BRANDING_SUCCESS,
    UPDATE_STATUSPAGE_BRANDING_FAILURE,
    UPDATE_STATUSPAGE_BRANDING_RESET,
    UPDATE_STATUSPAGE_NAME_FAILURE,
    UPDATE_STATUSPAGE_NAME_REQUEST,
    UPDATE_STATUSPAGE_NAME_RESET,
    UPDATE_STATUSPAGE_NAME_SUCCESS,
    UPDATE_STATUSPAGE_LINKS_REQUEST,
    UPDATE_STATUSPAGE_LINKS_SUCCESS,
    UPDATE_STATUSPAGE_LINKS_FAILURE,
    UPDATE_STATUSPAGE_LINKS_RESET,
    FETCH_STATUSPAGE_REQUEST,
    FETCH_STATUSPAGE_SUCCESS,
    FETCH_STATUSPAGE_FAILURE,
    FETCH_STATUSPAGE_RESET,
    FETCH_SUBPROJECT_STATUSPAGE_REQUEST,
    FETCH_SUBPROJECT_STATUSPAGE_SUCCESS,
    FETCH_SUBPROJECT_STATUSPAGE_FAILURE,
    FETCH_SUBPROJECT_STATUSPAGE_RESET,
    FETCH_PROJECT_STATUSPAGE_REQUEST,
    FETCH_PROJECT_STATUSPAGE_SUCCESS,
    FETCH_PROJECT_STATUSPAGE_FAILURE,
    FETCH_PROJECT_STATUSPAGE_RESET,
    DELETE_PROJECT_STATUSPAGES,
    DELETE_STATUSPAGE_REQUEST,
    DELETE_STATUSPAGE_SUCCESS,
    DELETE_STATUSPAGE_FAILED,
    DELETE_STATUSPAGE_RESET,
    LOGO_CACHE_INSERT,
    FAVICON_CACHE_INSERT,
    LOGO_CACHE_RESET,
    FAVICON_CACHE_RESET,
    SWITCH_STATUSPAGE_SUCCESS,
    BANNER_CACHE_INSERT,
    BANNER_CACHE_RESET,
    SET_STATUS_PAGE_COLORS,
    UPDATE_SUBSCRIBER_OPTION_REQUEST,
    UPDATE_SUBSCRIBER_OPTION_SUCCESS,
    UPDATE_SUBSCRIBER_OPTION_FAILURE,
    UPDATE_SUBSCRIBER_OPTION_RESET,
    ADD_MORE_DOMAIN,
    CANCEL_ADD_MORE_DOMAIN
} from '../constants/statusPage';

import {
    PAGINATE_NEXT,
    PAGINATE_PREV,
    PAGINATE_RESET,
} from '../constants/statusPage';

const INITIAL_STATE = {
    addMoreDomain: false,
    setting: {
        error: null,
        requesting: false,
        success: false,
    },
    newStatusPage: {
        error: null,
        requesting: false,
        success: false,
        statusPage: null,
    },
    monitors: {
        error: null,
        requesting: false,
        success: false,
    },
    privateStatusPage: {
        error: null,
        requesting: false,
        success: false,
    },
    branding: {
        error: null,
        requesting: false,
        success: false,
    },
    pageName: {
        error: null,
        requesting: false,
        success: false,
    },
    links: {
        error: null,
        requesting: false,
        success: false,
    },
    logocache: {
        data: null,
    },
    bannercache: {
        data: null,
    },
    colors: {},
    faviconcache: {
        data: null,
    },
    deleteStatusPage: {
        success: false,
        requesting: false,
        error: null,
    },
    subscriberOption: {
        success: false,
        requesting: false,
        error: null,
    },
    //this is for main status page object.
    error: null,
    requesting: false,
    success: false,
    status: {},
    statusPages: [],
    subProjectStatusPages: [],
    count: null,
    limit: null,
    skip: null,
    pages: {
        counter: 1,
    },
};

export default function statusPage(state = INITIAL_STATE, action) {
    let status, statusPage, isExistingStatusPage;
    switch (action.type) {
        //create statuspage
        case CREATE_STATUSPAGE_REQUEST:
            return Object.assign({}, state, {
                newStatusPage: {
                    ...state.newStatusPage,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case CREATE_STATUSPAGE_SUCCESS:
            isExistingStatusPage = state.subProjectStatusPages.find(
                statusPage => statusPage._id === action.payload.projectId
            );
            return Object.assign({}, state, {
                newStatusPage: {
                    requesting: false,
                    error: null,
                    success: true,
                    newStatusPage: action.payload,
                },
                subProjectStatusPages: isExistingStatusPage
                    ? state.subProjectStatusPages.length > 0
                        ? state.subProjectStatusPages.map(statusPage => {
                            return statusPage._id === action.payload.projectId
                                ? {
                                    _id: action.payload.projectId,
                                    statusPages: [
                                        action.payload,
                                        ...statusPage.statusPages.filter(
                                            (status, index) => index < 9
                                        ),
                                    ],
                                    count: statusPage.count + 1,
                                    skip: statusPage.skip,
                                    limit: statusPage.limit,
                                }
                                : statusPage;
                        })
                        : [
                            {
                                _id: action.payload.projectId,
                                statusPages: [action.payload],
                                count: 1,
                                skip: 0,
                                limit: 0,
                            },
                        ]
                    : state.subProjectStatusPages.concat([
                        {
                            _id: action.payload.projectId,
                            statusPages: [action.payload],
                            count: 1,
                            skip: 0,
                            limit: 0,
                        },
                    ]),
            });

        case CREATE_STATUSPAGE_FAILURE:
            return Object.assign({}, state, {
                newStatusPage: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case CREATE_STATUSPAGE_RESET:
            return Object.assign({}, state, {
                ...INITIAL_STATE,
            });

        //handle domain input field
        case ADD_MORE_DOMAIN:
            return { 
                ...state, 
                addMoreDomain: true 
            };

        case CANCEL_ADD_MORE_DOMAIN:
            return {
                ...state,
                addMoreDomain: false
            }

        //update setting
        case UPDATE_STATUSPAGE_SETTING_REQUEST:
            return Object.assign({}, state, {
                setting: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case UPDATE_STATUSPAGE_SETTING_SUCCESS:
            status = action.payload;
            return Object.assign({}, state, {
                addMoreDomain: false,
                setting: {
                    requesting: false,
                    error: null,
                    success: true,
                },
                status,
            });

        case UPDATE_STATUSPAGE_SETTING_FAILURE:
            return Object.assign({}, state, {
                setting: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case UPDATE_STATUSPAGE_SETTING_RESET:
            return Object.assign({}, state, {
                ...INITIAL_STATE,
            });

        // update monitor
        case UPDATE_STATUSPAGE_MONITORS_REQUEST:
            return Object.assign({}, state, {
                monitors: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case UPDATE_STATUSPAGE_MONITORS_SUCCESS:
            status = action.payload;
            return Object.assign({}, state, {
                monitors: {
                    requesting: false,
                    error: null,
                    success: true,
                },
                status,
            });

        case UPDATE_STATUSPAGE_MONITORS_FAILURE:
            return Object.assign({}, state, {
                monitors: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case UPDATE_STATUSPAGE_MONITORS_RESET:
            return Object.assign({}, state, {
                ...INITIAL_STATE,
            });

        // update private statuspages
        case UPDATE_PRIVATE_STATUSPAGE_REQUEST:
            return Object.assign({}, state, {
                privateStatusPage: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case UPDATE_PRIVATE_STATUSPAGE_SUCCESS:
            status = action.payload;
            return Object.assign({}, state, {
                privateStatusPage: {
                    requesting: false,
                    error: null,
                    success: true,
                },
                status,
            });

        case UPDATE_PRIVATE_STATUSPAGE_FAILURE:
            return Object.assign({}, state, {
                privateStatusPage: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case UPDATE_PRIVATE_STATUSPAGE_RESET:
            return Object.assign({}, state, {
                ...INITIAL_STATE,
            });

        // update subscriber options
        case UPDATE_SUBSCRIBER_OPTION_REQUEST:
            return Object.assign({}, state, {
                subscriberOption: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case UPDATE_SUBSCRIBER_OPTION_SUCCESS:
            status = action.payload;
            return Object.assign({}, state, {
                subscriberOption: {
                    requesting: false,
                    error: null,
                    success: true,
                },
                status,
            });

        case UPDATE_SUBSCRIBER_OPTION_FAILURE:
            return Object.assign({}, state, {
                subscriberOption: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case UPDATE_SUBSCRIBER_OPTION_RESET:
            return Object.assign({}, state, {
                ...INITIAL_STATE,
            });
        // update branding
        case UPDATE_STATUSPAGE_BRANDING_REQUEST:
            return Object.assign({}, state, {
                branding: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case UPDATE_STATUSPAGE_BRANDING_SUCCESS:
            status = action.payload;
            return Object.assign({}, state, {
                branding: {
                    requesting: false,
                    error: null,
                    success: true,
                },
                status,
            });

        case UPDATE_STATUSPAGE_BRANDING_FAILURE:
            return Object.assign({}, state, {
                branding: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case UPDATE_STATUSPAGE_BRANDING_RESET:
            return Object.assign({}, state, {
                ...INITIAL_STATE,
            });

        // update status page name
        case UPDATE_STATUSPAGE_NAME_REQUEST:
            return Object.assign({}, state, {
                pageName: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case UPDATE_STATUSPAGE_NAME_SUCCESS:
            status = action.payload;
            return Object.assign({}, state, {
                pageName: {
                    requesting: false,
                    error: null,
                    success: true,
                },
                status,
            });

        case UPDATE_STATUSPAGE_NAME_FAILURE:
            return Object.assign({}, state, {
                pageName: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case UPDATE_STATUSPAGE_NAME_RESET:
            return Object.assign({}, state, {
                ...INITIAL_STATE,
            });

        // update links
        case UPDATE_STATUSPAGE_LINKS_REQUEST:
            return Object.assign({}, state, {
                links: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case UPDATE_STATUSPAGE_LINKS_SUCCESS:
            status = action.payload;
            return Object.assign({}, state, {
                links: {
                    requesting: false,
                    error: null,
                    success: true,
                },
                status,
            });

        case UPDATE_STATUSPAGE_LINKS_FAILURE:
            return Object.assign({}, state, {
                links: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case UPDATE_STATUSPAGE_LINKS_RESET:
            return Object.assign({}, state, {
                ...INITIAL_STATE,
            });

        // fetch status page
        case FETCH_STATUSPAGE_REQUEST:
            return Object.assign({}, state, {
                ...state,
                error: null,
                requesting: true,
                success: false,
                status: {},
            });

        case FETCH_STATUSPAGE_FAILURE:
            return Object.assign({}, state, {
                status: {},
                requesting: false,
                success: false,
                error: action.payload,
            });

        case FETCH_STATUSPAGE_RESET:
            return Object.assign({}, state, {
                status: INITIAL_STATE.statusPage,
            });

        case FETCH_STATUSPAGE_SUCCESS:
            return Object.assign({}, state, {
                statusPages: action.payload.data,
                error: null,
                requesting: false,
                success: false,
            });

        // fetch subproject status pages
        case FETCH_SUBPROJECT_STATUSPAGE_REQUEST:
            return Object.assign({}, state, {
                ...state,
                error: null,
                requesting: true,
                success: false,
                status: {},
            });

        case FETCH_SUBPROJECT_STATUSPAGE_FAILURE:
            return Object.assign({}, state, {
                status: {},
                requesting: false,
                success: false,
                error: action.payload,
            });

        case FETCH_SUBPROJECT_STATUSPAGE_RESET:
            return Object.assign({}, state, {
                subProjectStatusPages: [],
            });

        case FETCH_SUBPROJECT_STATUSPAGE_SUCCESS:
            return Object.assign({}, state, {
                subProjectStatusPages: action.payload,
                error: null,
                requesting: false,
                success: true,
            });

        // fetch list of statuspages in a project
        case FETCH_PROJECT_STATUSPAGE_REQUEST:
            return Object.assign({}, state, {
                ...state,
                error: null,
                requesting: true,
                success: false,
            });

        case FETCH_PROJECT_STATUSPAGE_FAILURE:
            return Object.assign({}, state, {
                requesting: false,
                success: false,
                error: action.payload,
            });

        case FETCH_PROJECT_STATUSPAGE_RESET:
            return Object.assign({}, state, {
                ...INITIAL_STATE,
            });

        case FETCH_PROJECT_STATUSPAGE_SUCCESS:
            return Object.assign({}, state, {
                subProjectStatusPages: state.subProjectStatusPages.map(
                    statusPage => {
                        return statusPage._id === action.payload.projectId
                            ? {
                                _id: action.payload.projectId,
                                statusPages: [...action.payload.data],
                                count: action.payload.count,
                                skip: action.payload.skip,
                                limit: action.payload.limit,
                            }
                            : statusPage;
                    }
                ),
                error: null,
                requesting: false,
                success: true,
            });

        case SWITCH_STATUSPAGE_SUCCESS:
            return Object.assign({}, state, {
                status: action.payload || {},
                colors: action.payload.colors,
            });

        case DELETE_PROJECT_STATUSPAGES:
            statusPage = Object.assign([], state.statusPage);
            statusPage = statusPage.filter(
                status => status.projectId !== action.payload
            );
            return Object.assign({}, state, {
                statusPage,
            });

        case DELETE_STATUSPAGE_SUCCESS:
            return Object.assign({}, state, {
                deleteStatusPage: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                statusPages: state.statusPages.filter(
                    ({ _id }) => _id !== action.payload._id
                ),
                subProjectStatusPages: state.subProjectStatusPages.map(
                    subProjectStatusPage => {
                        subProjectStatusPage.statusPages = subProjectStatusPage.statusPages.filter(
                            ({ _id }) => _id !== action.payload._id
                        );
                        return subProjectStatusPage;
                    }
                ),
            });

        case DELETE_STATUSPAGE_REQUEST:
            return Object.assign({}, state, {
                deleteStatusPage: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });

        case DELETE_STATUSPAGE_FAILED:
            return Object.assign({}, state, {
                deleteStatusPage: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case DELETE_STATUSPAGE_RESET:
            return Object.assign({}, state, {
                deleteStatusPage: {
                    requesting: false,
                    success: false,
                    error: null,
                },
            });

        case LOGO_CACHE_INSERT:
            return Object.assign({}, state, {
                logocache: {
                    data: action.payload,
                },
            });

        case FAVICON_CACHE_INSERT:
            return Object.assign({}, state, {
                faviconcache: {
                    data: action.payload,
                },
            });

        case LOGO_CACHE_RESET:
            return Object.assign({}, state, {
                logocache: {
                    data: null,
                },
            });

        case FAVICON_CACHE_RESET:
            return Object.assign({}, state, {
                faviconcache: {
                    data: null,
                },
            });

        case BANNER_CACHE_INSERT:
            return Object.assign({}, state, {
                bannercache: {
                    data: action.payload,
                },
            });

        case BANNER_CACHE_RESET:
            return Object.assign({}, state, {
                bannercache: {
                    data: null,
                },
            });

        case SET_STATUS_PAGE_COLORS:
            return Object.assign({}, state, {
                colors: action.payload,
            });

        case PAGINATE_NEXT:
            return {
                ...state,
                pages: {
                    counter: state.pages.counter + 1,
                },
            };

        case PAGINATE_PREV:
            return {
                ...state,
                pages: {
                    counter: state.pages.counter - 1,
                },
            };

        case PAGINATE_RESET:
            return {
                ...state,
                pages: {
                    counter: 1,
                },
            };

        default:
            return state;
    }
}
