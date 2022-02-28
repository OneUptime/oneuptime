import {
    CREATE_STATUS_PAGE_CATEGORY_FAILURE,
    CREATE_STATUS_PAGE_CATEGORY_REQUEST,
    CREATE_STATUS_PAGE_CATEGORY_SUCCESS,
    UPDATE_STATUS_PAGE_CATEGORY_FAILURE,
    UPDATE_STATUS_PAGE_CATEGORY_REQUEST,
    UPDATE_STATUS_PAGE_CATEGORY_SUCCESS,
    FETCH_STATUS_PAGE_CATEGORIES_FAILURE,
    FETCH_STATUS_PAGE_CATEGORIES_REQUEST,
    FETCH_STATUS_PAGE_CATEGORIES_SUCCESS,
    FETCH_ALL_STATUS_PAGE_CATEGORIES_FAILURE,
    FETCH_ALL_STATUS_PAGE_CATEGORIES_REQUEST,
    FETCH_ALL_STATUS_PAGE_CATEGORIES_SUCCESS,
    DELETE_STATUS_PAGE_CATEGORY_FAILURE,
    DELETE_STATUS_PAGE_CATEGORY_REQUEST,
    DELETE_STATUS_PAGE_CATEGORY_SUCCESS,
} from '../constants/statusPageCategory';

const INITIAL_STATE = {
    fetchStatusPageCategories: {
        categories: [],
        error: null,
        requesting: false,
        success: false,
        skip: 0,
        limit: 10,
        count: 0,
    },
    fetchAllStatusPageCategories: {
        categories: [],
        error: null,
        requesting: false,
        success: false,
        skip: 0,
        limit: 10,
        count: 0,
    },
    createStatusPageCategory: {
        category: null,
        error: null,
        requesting: false,
        success: false,
    },
    updateStatusPageCategory: {
        category: null,
        error: null,
        requesting: false,
        success: false,
    },
    deleteStatusPageCategory: {
        error: null,
        requesting: false,
        success: false,
        category: null,
    },
};

export default function resourceCategory(
    state = INITIAL_STATE,
    action: $TSFixMe
) {
    switch (action.type) {
        case CREATE_STATUS_PAGE_CATEGORY_REQUEST:
            return {
                ...state,
                createStatusPageCategory: {
                    ...state.createStatusPageCategory,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case CREATE_STATUS_PAGE_CATEGORY_SUCCESS:
            return {
                ...state,
                createStatusPageCategory: {
                    requesting: false,
                    error: null,
                    success: true,
                    category: action.payload,
                },
            };
        case CREATE_STATUS_PAGE_CATEGORY_FAILURE:
            return {
                ...state,
                createStatusPageCategory: {
                    ...state.createStatusPageCategory,
                    requesting: false,
                    error: action.payload,
                },
            };
        case UPDATE_STATUS_PAGE_CATEGORY_REQUEST:
            return {
                ...state,
                updateStatusPageCategory: {
                    ...state.updateStatusPageCategory,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case UPDATE_STATUS_PAGE_CATEGORY_SUCCESS:
            return {
                ...state,
                updateStatusPageCategory: {
                    requesting: false,
                    success: true,
                    error: null,
                    category: action.payload,
                },
                fetchStatusPageCategories: {
                    ...state.fetchStatusPageCategories,
                    categories: state.fetchStatusPageCategories.categories.map(
                        category => {
                            if (
                                String(category._id) ===
                                String(action.payload._id)
                            ) {
                                category = action.payload;
                            }
                            return category;
                        }
                    ),
                },
            };
        case UPDATE_STATUS_PAGE_CATEGORY_FAILURE:
            return {
                ...state,
                updateStatusPageCategory: {
                    ...state.updateStatusPageCategory,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case FETCH_STATUS_PAGE_CATEGORIES_REQUEST:
            return {
                ...state,
                fetchStatusPageCategories: {
                    ...state.fetchStatusPageCategories,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case FETCH_STATUS_PAGE_CATEGORIES_SUCCESS:
            return {
                ...state,
                fetchStatusPageCategories: {
                    requesting: false,
                    success: true,
                    error: null,
                    categories: action.payload.data,
                    skip: action.payload.skip,
                    limit: action.payload.limit,
                    count: action.payload.count,
                },
            };
        case FETCH_STATUS_PAGE_CATEGORIES_FAILURE:
            return {
                ...state,
                fetchStatusPageCategories: {
                    ...state.fetchStatusPageCategories,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case FETCH_ALL_STATUS_PAGE_CATEGORIES_REQUEST:
            return {
                ...state,
                fetchAllStatusPageCategories: {
                    ...state.fetchAllStatusPageCategories,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case FETCH_ALL_STATUS_PAGE_CATEGORIES_SUCCESS:
            return {
                ...state,
                fetchAllStatusPageCategories: {
                    requesting: false,
                    success: true,
                    error: null,
                    categories: action.payload.data,
                    skip: action.payload.skip,
                    limit: action.payload.limit,
                    count: action.payload.count,
                },
            };
        case FETCH_ALL_STATUS_PAGE_CATEGORIES_FAILURE:
            return {
                ...state,
                fetchAllStatusPageCategories: {
                    ...state.fetchAllStatusPageCategories,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case DELETE_STATUS_PAGE_CATEGORY_REQUEST:
            return {
                ...state,
                deleteStatusPageCategory: {
                    ...state.deleteStatusPageCategory,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case DELETE_STATUS_PAGE_CATEGORY_SUCCESS:
            return {
                ...state,
                deleteStatusPageCategory: {
                    requesting: false,
                    success: true,
                    error: null,
                    category: action.payload,
                },
                fetchStatusPageCategories: {
                    ...state.fetchStatusPageCategories,
                    categories: state.fetchStatusPageCategories.categories.filter(
                        category =>
                            String(category._id) !== String(action.payload._id)
                    ),
                    count: state.fetchStatusPageCategories.count - 1,
                },
            };
        case DELETE_STATUS_PAGE_CATEGORY_FAILURE:
            return {
                ...state,
                deleteStatusPageCategory: {
                    ...state.deletedStatusPageCategory,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        default:
            return state;
    }
}
