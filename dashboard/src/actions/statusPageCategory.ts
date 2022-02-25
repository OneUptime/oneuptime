import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/statusPageCategory';
import errors from '../errors';

// create status page category
export const createStatusPageCategoryRequest = () => ({
    type: types.CREATE_STATUS_PAGE_CATEGORY_REQUEST,
});

export const createStatusPageCategorySuccess = payload => ({
    type: types.CREATE_STATUS_PAGE_CATEGORY_SUCCESS,
    payload,
});

export const createStatusPageCategoryFailure = error => ({
    type: types.CREATE_STATUS_PAGE_CATEGORY_FAILURE,
    payload: error,
});

export const createStatusPageCategory = ({
    projectId,
    statusPageId,
    statusPageCategoryName,
}) => dispatch => {
    const promise = postApi(`statusPageCategory/${projectId}/${statusPageId}`, {
        statusPageCategoryName,
    });
    dispatch(createStatusPageCategoryRequest());

    promise.then(
        function(response) {
            dispatch(createStatusPageCategorySuccess(response.data));
        },
        function(error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            } else {
                error = 'Network Error';
            }
            dispatch(createStatusPageCategoryFailure(errors(error)));
        }
    );
    return promise;
};

// update status page category
export const updateStatusPageCategoryRequest = () => ({
    type: types.UPDATE_STATUS_PAGE_CATEGORY_REQUEST,
});

export const updateStatusPageCategorySuccess = payload => ({
    type: types.UPDATE_STATUS_PAGE_CATEGORY_SUCCESS,
    payload,
});

export const updateStatusPageCategoryFailure = error => ({
    type: types.UPDATE_STATUS_PAGE_CATEGORY_FAILURE,
    payload: error,
});

export const updateStatusPageCategory = ({
    projectId,
    statusPageCategoryId,
    statusPageCategoryName,
}) => dispatch => {
    const promise = putApi(
        `statusPageCategory/${projectId}/${statusPageCategoryId}`,
        {
            statusPageCategoryName,
        }
    );
    dispatch(updateStatusPageCategoryRequest());

    promise.then(
        function(response) {
            dispatch(updateStatusPageCategorySuccess(response.data));
        },
        function(error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            } else {
                error = 'Network Error';
            }
            dispatch(updateStatusPageCategoryFailure(errors(error)));
        }
    );
    return promise;
};

// fetch status page categories
export const fetchStatusPageCategoriesRequest = () => ({
    type: types.FETCH_STATUS_PAGE_CATEGORIES_REQUEST,
});

export const fetchStatusPageCategoriesSuccess = payload => ({
    type: types.FETCH_STATUS_PAGE_CATEGORIES_SUCCESS,
    payload,
});

export const fetchStatusPageCategoriesFailure = error => ({
    type: types.FETCH_STATUS_PAGE_CATEGORIES_FAILURE,
    payload: error,
});

export const fetchStatusPageCategories = ({
    projectId,
    statusPageId,
    skip,
    limit,
}) => dispatch => {
    if (!skip) {
        skip = 0;
    }
    if (!limit) {
        limit = 0;
    }
    const promise = getApi(
        `statusPageCategory/${projectId}/${statusPageId}?skip=${skip}&limit=${limit}`
    );
    dispatch(fetchStatusPageCategoriesRequest());

    promise.then(
        function(response) {
            dispatch(fetchStatusPageCategoriesSuccess(response.data));
        },
        function(error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            } else {
                error = 'Network Error';
            }
            dispatch(fetchStatusPageCategoriesFailure(errors(error)));
        }
    );
    return promise;
};

// fetch  status page categories
export const fetchAllStatusPageCategoriesRequest = () => ({
    type: types.FETCH_ALL_STATUS_PAGE_CATEGORIES_REQUEST,
});

export const fetchAllStatusPageCategoriesSuccess = payload => ({
    type: types.FETCH_ALL_STATUS_PAGE_CATEGORIES_SUCCESS,
    payload,
});

export const fetchAllStatusPageCategoriesFailure = error => ({
    type: types.FETCH_ALL_STATUS_PAGE_CATEGORIES_FAILURE,
    payload: error,
});

export const fetchAllStatusPageCategories = ({
    projectId,
    statusPageId,
    skip,
    limit,
}) => dispatch => {
    if (!skip) {
        skip = 0;
    }
    if (!limit) {
        limit = 0;
    }
    const promise = getApi(
        `statusPageCategory/${projectId}/${statusPageId}?skip=${skip}&limit=${limit}`
    );
    dispatch(fetchAllStatusPageCategoriesRequest());

    promise.then(
        function(response) {
            dispatch(fetchAllStatusPageCategoriesSuccess(response.data));
        },
        function(error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            } else {
                error = 'Network Error';
            }
            dispatch(fetchAllStatusPageCategoriesFailure(errors(error)));
        }
    );
    return promise;
};

// delete status page category
export const deleteStatusPageCategoryRequest = () => ({
    type: types.DELETE_STATUS_PAGE_CATEGORY_REQUEST,
});

export const deleteStatusPageCategorySuccess = payload => ({
    type: types.DELETE_STATUS_PAGE_CATEGORY_SUCCESS,
    payload,
});

export const deleteStatusPageCategoryFailure = error => ({
    type: types.DELETE_STATUS_PAGE_CATEGORY_FAILURE,
    payload: error,
});

export const deleteStatusPageCategory = ({
    projectId,
    statusPageCategoryId,
}) => dispatch => {
    const promise = deleteApi(
        `statusPageCategory/${projectId}/${statusPageCategoryId}`
    );
    dispatch(updateStatusPageCategoryRequest());

    promise.then(
        function(response) {
            dispatch(updateStatusPageCategorySuccess(response.data));
        },
        function(error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            } else {
                error = 'Network Error';
            }
            dispatch(updateStatusPageCategoryFailure(errors(error)));
        }
    );
    return promise;
};
