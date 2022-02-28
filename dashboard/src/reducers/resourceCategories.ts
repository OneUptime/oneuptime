import {
    FETCH_RESOURCE_CATEGORIES_REQUEST,
    FETCH_RESOURCE_CATEGORIES_SUCCESS,
    FETCH_RESOURCE_CATEGORIES_FAILURE,
    CREATE_RESOURCE_CATEGORY_REQUEST,
    CREATE_RESOURCE_CATEGORY_SUCCESS,
    CREATE_RESOURCE_CATEGORY_FAILURE,
    UPDATE_RESOURCE_CATEGORY_REQUEST,
    UPDATE_RESOURCE_CATEGORY_SUCCESS,
    UPDATE_RESOURCE_CATEGORY_FAILURE,
    DELETE_RESOURCE_CATEGORY_REQUEST,
    DELETE_RESOURCE_CATEGORY_SUCCESS,
    DELETE_RESOURCE_CATEGORY_FAILURE,
    FETCH_RESOURCE_CATEGORIES_FOR_NEW_RESOURCE_REQUEST,
    FETCH_RESOURCE_CATEGORIES_FOR_NEW_RESOURCE_SUCCESS,
    FETCH_RESOURCE_CATEGORIES_FOR_NEW_RESOURCE_FAILURE,
} from '../constants/resourceCategories';

const INITIAL_STATE = {
    resourceCategoryListForNewResource: {
        resourceCategories: [],
        error: null,
        requesting: false,
        success: false,
    },
    resourceCategoryList: {
        resourceCategories: [],
        error: null,
        requesting: false,
        success: false,
        skip: null,
        limit: null,
        count: null,
    },
    newResourceCategory: {
        resourceCategory: null,
        error: null,
        requesting: false,
        success: false,
    },
    updatedResourceCategory: {
        resourceCategory: null,
        error: null,
        requesting: false,
        success: false,
    },
    deletedResourceCategory: {
        error: null,
        requesting: false,
        success: false,
    },
};

export default function resourceCategory(
    state = INITIAL_STATE,
    action: $TSFixMe
) {
    switch (action.type) {
        case CREATE_RESOURCE_CATEGORY_SUCCESS:
            return Object.assign({}, state, {
                newResourceCategory: {
                    requesting: false,
                    error: null,
                    success: true,
                    resource: null,
                },
                resourceCategoryList: {
                    ...state.resourceCategoryList,
                    resourceCategories: state.resourceCategoryList.resourceCategories.concat(
                        action.payload
                    ),
                    
                    count: state.resourceCategoryList.count + 1,
                },
                resourceCategoryListForNewResource: {
                    ...state.resourceCategoryListForNewResource,
                    resourceCategories: state.resourceCategoryListForNewResource.resourceCategories.concat(
                        action.payload
                    ),
                },
            });
        case CREATE_RESOURCE_CATEGORY_FAILURE:
            return Object.assign({}, state, {
                ...state,
                newResourceCategory: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    resourceCategory:
                        state.newResourceCategory.resourceCategory,
                },
            });
        case CREATE_RESOURCE_CATEGORY_REQUEST:
            return Object.assign({}, state, {
                ...state,
                newResourceCategory: {
                    requesting: true,
                    error: null,
                    success: false,
                    resource: state.newResourceCategory.resourceCategory,
                },
            });

        case UPDATE_RESOURCE_CATEGORY_SUCCESS:
            return Object.assign({}, state, {
                updatedResourceCategory: {
                    requesting: false,
                    error: null,
                    success: true,
                    resource: null,
                },
                resourceCategoryList: {
                    ...state.resourceCategoryList,
                    resourceCategories: state.resourceCategoryList.resourceCategories.map(
                        item => {
                            
                            if (item._id === action.payload._id) {
                                
                                return { ...item, name: action.payload.name };
                            }
                            return item;
                        }
                    ),
                },
            });
        case UPDATE_RESOURCE_CATEGORY_REQUEST:
            return Object.assign({}, state, {
                ...state,
                updatedResourceCategory: {
                    requesting: true,
                    error: null,
                    success: false,
                    resource: state.updatedResourceCategory.resourceCategory,
                },
            });
        case UPDATE_RESOURCE_CATEGORY_FAILURE:
            return Object.assign({}, state, {
                ...state,
                updatedResourceCategory: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    resourceCategory:
                        state.updatedResourceCategory.resourceCategory,
                },
            });

        case FETCH_RESOURCE_CATEGORIES_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                resourceCategoryList: {
                    requesting: false,
                    error: null,
                    success: true,
                    resourceCategories: action.payload.data,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip,
                },
            });
        case FETCH_RESOURCE_CATEGORIES_FAILURE:
            return Object.assign({}, state, {
                ...state,
                resourceCategoryList: {
                    ...state.resourceCategoryList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case FETCH_RESOURCE_CATEGORIES_REQUEST:
            return Object.assign({}, state, {
                ...state,
                resourceCategoryList: {
                    ...state.resourceCategoryList,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case DELETE_RESOURCE_CATEGORY_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                resourceCategoryListForNewResource: {
                    ...state.resourceCategoryListForNewResource,
                    resourceCategories: state.resourceCategoryListForNewResource.resourceCategories.filter(
                        resourceCategory => {
                            
                            if (resourceCategory._id === action.payload) {
                                return false;
                            } else {
                                return true;
                            }
                        }
                    ),
                },
                resourceCategoryList: {
                    ...state.resourceCategoryList,
                    resourceCategories: state.resourceCategoryList.resourceCategories.filter(
                        resourceCategory => {
                            
                            if (resourceCategory._id === action.payload) {
                                return false;
                            } else {
                                return true;
                            }
                        }
                    ),
                    
                    count: state.resourceCategoryList.count - 1,
                },
                deletedResourceCategory: {
                    requesting: false,
                    success: true,
                    error: false,
                },
                newResourceCategory: {
                    ...INITIAL_STATE.newResourceCategory,
                },
            });
        case DELETE_RESOURCE_CATEGORY_FAILURE:
            return Object.assign({}, state, {
                ...state,
                deletedResourceCategory: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });
        case DELETE_RESOURCE_CATEGORY_REQUEST:
            return Object.assign({}, state, {
                ...state,
                deletedResourceCategory: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });

        case FETCH_RESOURCE_CATEGORIES_FOR_NEW_RESOURCE_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                resourceCategoryListForNewResource: {
                    requesting: false,
                    error: null,
                    success: true,
                    resourceCategories: action.payload.data,
                    count: action.payload.count,
                },
            });
        case FETCH_RESOURCE_CATEGORIES_FOR_NEW_RESOURCE_FAILURE:
            return Object.assign({}, state, {
                ...state,
                resourceCategoryListForNewResource: {
                    ...state.resourceCategoryListForNewResource,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });
        case FETCH_RESOURCE_CATEGORIES_FOR_NEW_RESOURCE_REQUEST:
            return Object.assign({}, state, {
                ...state,
                resourceCategoryListForNewResource: {
                    ...state.resourceCategoryListForNewResource,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        default:
            return state;
    }
}
