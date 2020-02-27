import {
    FETCH_MONITOR_CATEGORIES_REQUEST,
    FETCH_MONITOR_CATEGORIES_SUCCESS,
    FETCH_MONITOR_CATEGORIES_FAILURE,
    CREATE_MONITOR_CATEGORY_REQUEST,
    CREATE_MONITOR_CATEGORY_SUCCESS,
    CREATE_MONITOR_CATEGORY_FAILURE,
    UPDATE_MONITOR_CATEGORY_REQUEST,
    UPDATE_MONITOR_CATEGORY_SUCCESS,
    UPDATE_MONITOR_CATEGORY_FAILURE,
    DELETE_MONITOR_CATEGORY_REQUEST,
    DELETE_MONITOR_CATEGORY_SUCCESS,
    DELETE_MONITOR_CATEGORY_FAILURE,
    FETCH_MONITOR_CATEGORIES_FOR_NEW_MONITOR_REQUEST,
    FETCH_MONITOR_CATEGORIES_FOR_NEW_MONITOR_SUCCESS,
    FETCH_MONITOR_CATEGORIES_FOR_NEW_MONITOR_FAILURE,
} from '../constants/monitorCategories';

const INITIAL_STATE = {
    monitorCategoryListForNewMonitor: {
        monitorCategories: [],
        error: null,
        requesting: false,
        success: false,
    },
    monitorCategoryList: {
        monitorCategories: [],
        error: null,
        requesting: false,
        success: false,
        skip: null,
        limit: null,
        count: null,
    },
    newMonitorCategory: {
        monitorCategory: null,
        error: null,
        requesting: false,
        success: false,
    },
    updatedMonitorCategory: {
        monitorCategory: null,
        error: null,
        requesting: false,
        success: false,
    },
    deletedMonitorCategory: {
        error: null,
        requesting: false,
        success: false,
    },
};

export default function monitorCategory(state = INITIAL_STATE, action) {
    switch (action.type) {
        case CREATE_MONITOR_CATEGORY_SUCCESS:
            return Object.assign({}, state, {
                newMonitorCategory: {
                    requesting: false,
                    error: null,
                    success: true,
                    monitor: null,
                },
                monitorCategoryList: {
                    ...state.monitorCategoryList,
                    monitorCategories: state.monitorCategoryList.monitorCategories.concat(
                        action.payload
                    ),
                    count: state.monitorCategoryList.count + 1,
                },
                monitorCategoryListForNewMonitor: {
                    ...state.monitorCategoryListForNewMonitor,
                    monitorCategories: state.monitorCategoryListForNewMonitor.monitorCategories.concat(
                        action.payload
                    ),
                },
            });
        case CREATE_MONITOR_CATEGORY_FAILURE:
            return Object.assign({}, state, {
                ...state,
                newMonitorCategory: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    monitorCategory: state.newMonitorCategory.monitorCategory,
                },
            });
        case CREATE_MONITOR_CATEGORY_REQUEST:
            return Object.assign({}, state, {
                ...state,
                newMonitorCategory: {
                    requesting: true,
                    error: null,
                    success: false,
                    monitor: state.newMonitorCategory.monitorCategory,
                },
            });

        case UPDATE_MONITOR_CATEGORY_SUCCESS:
            return Object.assign({}, state, {
                updatedMonitorCategory: {
                    requesting: false,
                    error: null,
                    success: true,
                    monitor: null,
                },
                monitorCategoryList: {
                    ...state.monitorCategoryList,
                    monitorCategories: state.monitorCategoryList.monitorCategories.map(
                        item => {
                            if (item._id === action.payload._id) {
                                return { ...item, name: action.payload.name };
                            }
                            return item;
                        }
                    ),
                },
            });
        case UPDATE_MONITOR_CATEGORY_REQUEST:
            return Object.assign({}, state, {
                ...state,
                updatedMonitorCategory: {
                    requesting: true,
                    error: null,
                    success: false,
                    monitor: state.updatedMonitorCategory.monitorCategory,
                },
            });
        case UPDATE_MONITOR_CATEGORY_FAILURE:
            return Object.assign({}, state, {
                ...state,
                updatedMonitorCategory: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    monitorCategory:
                        state.updatedMonitorCategory.monitorCategory,
                },
            });

        case FETCH_MONITOR_CATEGORIES_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                monitorCategoryList: {
                    requesting: false,
                    error: null,
                    success: true,
                    monitorCategories: action.payload.data,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip,
                },
            });
        case FETCH_MONITOR_CATEGORIES_FAILURE:
            return Object.assign({}, state, {
                ...state,
                monitorCategoryList: {
                    ...state.monitorCategoryList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case FETCH_MONITOR_CATEGORIES_REQUEST:
            return Object.assign({}, state, {
                ...state,
                monitorCategoryList: {
                    ...state.monitorCategoryList,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case DELETE_MONITOR_CATEGORY_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                monitorCategoryListForNewMonitor: {
                    ...state.monitorCategoryListForNewMonitor,
                    monitorCategories: state.monitorCategoryListForNewMonitor.monitorCategories.filter(
                        monitorCategory => {
                            if (monitorCategory._id === action.payload) {
                                return false;
                            } else {
                                return true;
                            }
                        }
                    ),
                },
                monitorCategoryList: {
                    ...state.monitorCategoryList,
                    monitorCategories: state.monitorCategoryList.monitorCategories.filter(
                        monitorCategory => {
                            if (monitorCategory._id === action.payload) {
                                return false;
                            } else {
                                return true;
                            }
                        }
                    ),
                    count: state.monitorCategoryList.count - 1,
                },
                deletedMonitorCategory: {
                    requesting: false,
                    success: true,
                    error: false,
                },
                newMonitorCategory: {
                    ...INITIAL_STATE.newMonitorCategory,
                },
            });
        case DELETE_MONITOR_CATEGORY_FAILURE:
            return Object.assign({}, state, {
                ...state,
                deletedMonitorCategory: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });
        case DELETE_MONITOR_CATEGORY_REQUEST:
            return Object.assign({}, state, {
                ...state,
                deletedMonitorCategory: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });

        case FETCH_MONITOR_CATEGORIES_FOR_NEW_MONITOR_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                monitorCategoryListForNewMonitor: {
                    requesting: false,
                    error: null,
                    success: true,
                    monitorCategories: action.payload.data,
                    count: action.payload.count,
                },
            });
        case FETCH_MONITOR_CATEGORIES_FOR_NEW_MONITOR_FAILURE:
            return Object.assign({}, state, {
                ...state,
                monitorCategoryListForNewMonitor: {
                    ...state.monitorCategoryListForNewMonitor,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });
        case FETCH_MONITOR_CATEGORIES_FOR_NEW_MONITOR_REQUEST:
            return Object.assign({}, state, {
                ...state,
                monitorCategoryListForNewMonitor: {
                    ...state.monitorCategoryListForNewMonitor,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        default:
            return state;
    }
}
