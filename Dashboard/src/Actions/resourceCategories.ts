import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/resourceCategories';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
export function fetchResourceCategories(
    projectId: ObjectID,
    skip: PositiveNumber,
    limit: PositiveNumber
): void {
    skip = parseInt(skip);
    limit = parseInt(limit);
    return function (dispatch: Dispatch): void {
        let promise = null;
        if (skip >= 0 && limit >= 0) {
            promise = BackendAPI.get(
                `resourceCategory/${projectId}?skip=${skip}&limit=${limit}`
            );
        } else {
            promise = BackendAPI.get(
                `resourceCategory/${projectId}?skip=${0}&limit=${10}`
            );
        }
        dispatch(fetchResourceCategoriesRequest());

        promise.then(
            (resourceCategories): void => {
                dispatch(
                    fetchResourceCategoriesSuccess(resourceCategories.data)
                );
            },
            (error): void => {
                dispatch(fetchResourceCategoriesFailure(error));
            }
        );
        return promise;
    };
}

export const fetchResourceCategoriesSuccess = (
    resourceCategories: $TSFixMe
): void => {
    return {
        type: types.FETCH_RESOURCE_CATEGORIES_SUCCESS,
        payload: resourceCategories,
    };
};

export const fetchResourceCategoriesRequest = (): void => {
    return {
        type: types.FETCH_RESOURCE_CATEGORIES_REQUEST,
    };
};

export const fetchResourceCategoriesFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_RESOURCE_CATEGORIES_FAILURE,
        payload: error,
    };
};

export const createResourceCategory = (
    projectId: ObjectID,
    values: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
            `resourceCategory/${projectId}`,
            values
        );
        dispatch(createResourceCategoryRequest());

        promise.then(
            (resourceCategory): void => {
                dispatch(createResourceCategorySuccess(resourceCategory.data));
            },
            (error): void => {
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
                dispatch(createResourceCategoryFailure(error));
            }
        );
        return promise;
    };
};

export function updateResourceCategory(
    projectId: ObjectID,
    resourceCategoryId: $TSFixMe,
    values: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put(
            `resourceCategory/${projectId}/${resourceCategoryId}`,
            values
        );
        dispatch(updateResourceCategoryRequest());

        promise.then(
            (updatedResourceCategory): void => {
                dispatch(
                    updateResourceCategorySuccess(updatedResourceCategory.data)
                );
            },
            (error): void => {
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
                dispatch(updateResourceCategoryFailure(error));
            }
        );
        return promise;
    };
}

export const createResourceCategorySuccess = (
    newResourceCategory: $TSFixMe
): void => {
    return {
        type: types.CREATE_RESOURCE_CATEGORY_SUCCESS,
        payload: newResourceCategory,
    };
};

export const createResourceCategoryRequest = (): void => {
    return {
        type: types.CREATE_RESOURCE_CATEGORY_REQUEST,
    };
};

export const createResourceCategoryFailure = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_RESOURCE_CATEGORY_FAILURE,
        payload: error,
    };
};

export const updateResourceCategoryRequest = (): void => {
    return {
        type: types.UPDATE_RESOURCE_CATEGORY_REQUEST,
    };
};

export function updateResourceCategorySuccess(
    updatedResourceCategory: $TSFixMe
): void {
    return {
        type: types.UPDATE_RESOURCE_CATEGORY_SUCCESS,
        payload: updatedResourceCategory,
    };
}

export const updateResourceCategoryFailure = (error: ErrorPayload): void => {
    return {
        type: types.UPDATE_RESOURCE_CATEGORY_FAILURE,
        payload: error,
    };
};

export function deleteResourceCategory(
    resourceCategoryId: $TSFixMe,
    projectId: ObjectID
): void {
    return function (dispatch: Dispatch): void {
        const promise =
            delete `resourceCategory/${projectId}/${resourceCategoryId}`;
        dispatch(deleteResourceCategoryRequest(resourceCategoryId));

        promise.then(
            (resourceCategory): void => {
                dispatch(
                    deleteResourceCategorySuccess(resourceCategory.data._id)
                );
            },
            (error): void => {
                dispatch(deleteResourceCategoryFailure({ error: error }));
            }
        );
        return promise;
    };
}

export function deleteResourceCategorySuccess(
    removedResourceCategoryId: $TSFixMe
): void {
    return {
        type: types.DELETE_RESOURCE_CATEGORY_SUCCESS,
        payload: removedResourceCategoryId,
    };
}

export const deleteResourceCategoryRequest = (
    resourceCategoryId: $TSFixMe
): void => {
    return {
        type: types.DELETE_RESOURCE_CATEGORY_REQUEST,
        payload: resourceCategoryId,
    };
};

export const deleteResourceCategoryFailure = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_RESOURCE_CATEGORY_FAILURE,
        payload: error,
    };
};

export const fetchResourceCategoriesForNewResource = (
    projectId: ObjectID
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(`resourceCategory/${projectId}`);
        dispatch(fetchResourceCategoriesForNewResourceRequest());

        promise.then(
            (resourceCategories): void => {
                dispatch(
                    fetchResourceCategoriesForNewResourceSuccess(
                        resourceCategories.data
                    )
                );
            },
            (error): void => {
                dispatch(fetchResourceCategoriesForNewResourceFailure(error));
            }
        );
        return promise;
    };
};

export function fetchResourceCategoriesForNewResourceSuccess(
    resourceCategories: $TSFixMe
): void {
    return {
        type: types.FETCH_RESOURCE_CATEGORIES_FOR_NEW_RESOURCE_SUCCESS,
        payload: resourceCategories,
    };
}

export const fetchResourceCategoriesForNewResourceRequest = (): void => {
    return {
        type: types.FETCH_RESOURCE_CATEGORIES_FOR_NEW_RESOURCE_REQUEST,
    };
};

export const fetchResourceCategoriesForNewResourceFailure = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_RESOURCE_CATEGORIES_FOR_NEW_RESOURCE_FAILURE,
        payload: error,
    };
};
