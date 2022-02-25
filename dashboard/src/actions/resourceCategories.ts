import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/resourceCategories';
import errors from '../errors';

export function fetchResourceCategories(projectId, skip, limit) {
    skip = parseInt(skip);
    limit = parseInt(limit);
    return function(dispatch) {
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
            function(resourceCategories) {
                dispatch(
                    fetchResourceCategoriesSuccess(resourceCategories.data)
                );
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
                dispatch(fetchResourceCategoriesFailure(errors(error)));
            }
        );
        return promise;
    };
}

export function fetchResourceCategoriesSuccess(resourceCategories) {
    return {
        type: types.FETCH_RESOURCE_CATEGORIES_SUCCESS,
        payload: resourceCategories,
    };
}

export function fetchResourceCategoriesRequest() {
    return {
        type: types.FETCH_RESOURCE_CATEGORIES_REQUEST,
    };
}

export function fetchResourceCategoriesFailure(error) {
    return {
        type: types.FETCH_RESOURCE_CATEGORIES_FAILURE,
        payload: error,
    };
}

export function createResourceCategory(projectId, values) {
    return function(dispatch) {
        const promise = postApi(`resourceCategory/${projectId}`, values);
        dispatch(createResourceCategoryRequest());

        promise.then(
            function(resourceCategory) {
                dispatch(createResourceCategorySuccess(resourceCategory.data));
            },
            function(error) {
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
}

export function updateResourceCategory(projectId, resourceCategoryId, values) {
    return function(dispatch) {
        const promise = putApi(
            `resourceCategory/${projectId}/${resourceCategoryId}`,
            values
        );
        dispatch(updateResourceCategoryRequest());

        promise.then(
            function(updatedResourceCategory) {
                dispatch(
                    updateResourceCategorySuccess(updatedResourceCategory.data)
                );
            },
            function(error) {
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

export function createResourceCategorySuccess(newResourceCategory) {
    return {
        type: types.CREATE_RESOURCE_CATEGORY_SUCCESS,
        payload: newResourceCategory,
    };
}

export function createResourceCategoryRequest() {
    return {
        type: types.CREATE_RESOURCE_CATEGORY_REQUEST,
    };
}

export function createResourceCategoryFailure(error) {
    return {
        type: types.CREATE_RESOURCE_CATEGORY_FAILURE,
        payload: error,
    };
}

export function updateResourceCategoryRequest() {
    return {
        type: types.UPDATE_RESOURCE_CATEGORY_REQUEST,
    };
}

export function updateResourceCategorySuccess(updatedResourceCategory) {
    return {
        type: types.UPDATE_RESOURCE_CATEGORY_SUCCESS,
        payload: updatedResourceCategory,
    };
}

export function updateResourceCategoryFailure(error) {
    return {
        type: types.UPDATE_RESOURCE_CATEGORY_FAILURE,
        payload: error,
    };
}

export function deleteResourceCategory(resourceCategoryId, projectId) {
    return function(dispatch) {
        const promise = deleteApi(
            `resourceCategory/${projectId}/${resourceCategoryId}`
        );
        dispatch(deleteResourceCategoryRequest(resourceCategoryId));

        promise.then(
            function(resourceCategory) {
                dispatch(
                    deleteResourceCategorySuccess(resourceCategory.data._id)
                );
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
                dispatch(
                    deleteResourceCategoryFailure({ error: errors(error) })
                );
            }
        );
        return promise;
    };
}

export function deleteResourceCategorySuccess(removedResourceCategoryId) {
    return {
        type: types.DELETE_RESOURCE_CATEGORY_SUCCESS,
        payload: removedResourceCategoryId,
    };
}

export function deleteResourceCategoryRequest(resourceCategoryId) {
    return {
        type: types.DELETE_RESOURCE_CATEGORY_REQUEST,
        payload: resourceCategoryId,
    };
}

export function deleteResourceCategoryFailure(error) {
    return {
        type: types.DELETE_RESOURCE_CATEGORY_FAILURE,
        payload: error,
    };
}

export function fetchResourceCategoriesForNewResource(projectId) {
    return function(dispatch) {
        const promise = getApi(`resourceCategory/${projectId}`);
        dispatch(fetchResourceCategoriesForNewResourceRequest());

        promise.then(
            function(resourceCategories) {
                dispatch(
                    fetchResourceCategoriesForNewResourceSuccess(
                        resourceCategories.data
                    )
                );
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
                dispatch(
                    fetchResourceCategoriesForNewResourceFailure(errors(error))
                );
            }
        );
        return promise;
    };
}

export function fetchResourceCategoriesForNewResourceSuccess(
    resourceCategories
) {
    return {
        type: types.FETCH_RESOURCE_CATEGORIES_FOR_NEW_RESOURCE_SUCCESS,
        payload: resourceCategories,
    };
}

export function fetchResourceCategoriesForNewResourceRequest() {
    return {
        type: types.FETCH_RESOURCE_CATEGORIES_FOR_NEW_RESOURCE_REQUEST,
    };
}

export function fetchResourceCategoriesForNewResourceFailure(error) {
    return {
        type: types.FETCH_RESOURCE_CATEGORIES_FOR_NEW_RESOURCE_FAILURE,
        payload: error,
    };
}
