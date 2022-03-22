import { postApi, getApi, deleteApi, putApi } from '../api';
import { Dispatch } from 'redux';
import * as types from '../constants/resourceCategories';
import errors from '../errors';

export function fetchResourceCategories(
    projectId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) {
    skip = parseInt(skip);
    limit = parseInt(limit);
    return function (dispatch: Dispatch) {
        let promise = null;
        if (skip >= 0 && limit >= 0) {
            promise = getApi(
                `resourceCategory/${projectId}?skip=${skip}&limit=${limit}`
            );
        } else {
            promise = getApi(
                `resourceCategory/${projectId}?skip=${0}&limit=${10}`
            );
        }
        dispatch(fetchResourceCategoriesRequest());

        promise.then(
            function (resourceCategories) {
                dispatch(
                    fetchResourceCategoriesSuccess(resourceCategories.data)
                );
            },
            function (error) {
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
                dispatch(fetchResourceCategoriesFailure(errors(error)));
            }
        );
        return promise;
    };
}

export const fetchResourceCategoriesSuccess = (
    resourceCategories: $TSFixMe
) => {
    return {
        type: types.FETCH_RESOURCE_CATEGORIES_SUCCESS,
        payload: resourceCategories,
    };
};

export const fetchResourceCategoriesRequest = () => {
    return {
        type: types.FETCH_RESOURCE_CATEGORIES_REQUEST,
    };
};

export const fetchResourceCategoriesFailure = (error: $TSFixMe) => {
    return {
        type: types.FETCH_RESOURCE_CATEGORIES_FAILURE,
        payload: error,
    };
};

export const createResourceCategory = (
    projectId: $TSFixMe,
    values: $TSFixMe
) => {
    return function (dispatch: Dispatch) {
        const promise = postApi(`resourceCategory/${projectId}`, values);
        dispatch(createResourceCategoryRequest());

        promise.then(
            function (resourceCategory) {
                dispatch(createResourceCategorySuccess(resourceCategory.data));
            },
            function (error) {
                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(createResourceCategoryFailure(errors(error)));
            }
        );
        return promise;
    };
};

export function updateResourceCategory(
    projectId: $TSFixMe,
    resourceCategoryId: $TSFixMe,
    values: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = putApi(
            `resourceCategory/${projectId}/${resourceCategoryId}`,
            values
        );
        dispatch(updateResourceCategoryRequest());

        promise.then(
            function (updatedResourceCategory) {
                dispatch(
                    updateResourceCategorySuccess(updatedResourceCategory.data)
                );
            },
            function (error) {
                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(updateResourceCategoryFailure(errors(error)));
            }
        );
        return promise;
    };
}

export const createResourceCategorySuccess = (
    newResourceCategory: $TSFixMe
) => {
    return {
        type: types.CREATE_RESOURCE_CATEGORY_SUCCESS,
        payload: newResourceCategory,
    };
};

export const createResourceCategoryRequest = () => {
    return {
        type: types.CREATE_RESOURCE_CATEGORY_REQUEST,
    };
};

export const createResourceCategoryFailure = (error: $TSFixMe) => {
    return {
        type: types.CREATE_RESOURCE_CATEGORY_FAILURE,
        payload: error,
    };
};

export const updateResourceCategoryRequest = () => {
    return {
        type: types.UPDATE_RESOURCE_CATEGORY_REQUEST,
    };
};

export function updateResourceCategorySuccess(
    updatedResourceCategory: $TSFixMe
) {
    return {
        type: types.UPDATE_RESOURCE_CATEGORY_SUCCESS,
        payload: updatedResourceCategory,
    };
}

export const updateResourceCategoryFailure = (error: $TSFixMe) => {
    return {
        type: types.UPDATE_RESOURCE_CATEGORY_FAILURE,
        payload: error,
    };
};

export function deleteResourceCategory(
    resourceCategoryId: $TSFixMe,
    projectId: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = deleteApi(
            `resourceCategory/${projectId}/${resourceCategoryId}`
        );
        dispatch(deleteResourceCategoryRequest(resourceCategoryId));

        promise.then(
            function (resourceCategory) {
                dispatch(
                    deleteResourceCategorySuccess(resourceCategory.data._id)
                );
            },
            function (error) {
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
                dispatch(
                    deleteResourceCategoryFailure({ error: errors(error) })
                );
            }
        );
        return promise;
    };
}

export function deleteResourceCategorySuccess(
    removedResourceCategoryId: $TSFixMe
) {
    return {
        type: types.DELETE_RESOURCE_CATEGORY_SUCCESS,
        payload: removedResourceCategoryId,
    };
}

export const deleteResourceCategoryRequest = (resourceCategoryId: $TSFixMe) => {
    return {
        type: types.DELETE_RESOURCE_CATEGORY_REQUEST,
        payload: resourceCategoryId,
    };
};

export const deleteResourceCategoryFailure = (error: $TSFixMe) => {
    return {
        type: types.DELETE_RESOURCE_CATEGORY_FAILURE,
        payload: error,
    };
};

export const fetchResourceCategoriesForNewResource = (projectId: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = getApi(`resourceCategory/${projectId}`);
        dispatch(fetchResourceCategoriesForNewResourceRequest());

        promise.then(
            function (resourceCategories) {
                dispatch(
                    fetchResourceCategoriesForNewResourceSuccess(
                        resourceCategories.data
                    )
                );
            },
            function (error) {
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
                dispatch(
                    fetchResourceCategoriesForNewResourceFailure(errors(error))
                );
            }
        );
        return promise;
    };
};

export function fetchResourceCategoriesForNewResourceSuccess(
    resourceCategories: $TSFixMe
) {
    return {
        type: types.FETCH_RESOURCE_CATEGORIES_FOR_NEW_RESOURCE_SUCCESS,
        payload: resourceCategories,
    };
}

export const fetchResourceCategoriesForNewResourceRequest = () => {
    return {
        type: types.FETCH_RESOURCE_CATEGORIES_FOR_NEW_RESOURCE_REQUEST,
    };
};

export const fetchResourceCategoriesForNewResourceFailure = (
    error: $TSFixMe
) => {
    return {
        type: types.FETCH_RESOURCE_CATEGORIES_FOR_NEW_RESOURCE_FAILURE,
        payload: error,
    };
};
