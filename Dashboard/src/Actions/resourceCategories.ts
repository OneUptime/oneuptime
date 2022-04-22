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
        let promise: $TSFixMe = null;
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
            (resourceCategories: $TSFixMe): void => {
                dispatch(
                    fetchResourceCategoriesSuccess(resourceCategories.data)
                );
            },
            (error: $TSFixMe): void => {
                dispatch(fetchResourceCategoriesFailure(error));
            }
        );
        return promise;
    };
}

export const fetchResourceCategoriesSuccess: Function = (
    resourceCategories: $TSFixMe
): void => {
    return {
        type: types.FETCH_RESOURCE_CATEGORIES_SUCCESS,
        payload: resourceCategories,
    };
};

export const fetchResourceCategoriesRequest: Function = (): void => {
    return {
        type: types.FETCH_RESOURCE_CATEGORIES_REQUEST,
    };
};

export const fetchResourceCategoriesFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_RESOURCE_CATEGORIES_FAILURE,
        payload: error,
    };
};

export const createResourceCategory: Function = (
    projectId: ObjectID,
    values: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `resourceCategory/${projectId}`,
            values
        );
        dispatch(createResourceCategoryRequest());

        promise.then(
            (resourceCategory: $TSFixMe): void => {
                dispatch(createResourceCategorySuccess(resourceCategory.data));
            },
            (error: $TSFixMe): void => {
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
        const promise: $TSFixMe = BackendAPI.put(
            `resourceCategory/${projectId}/${resourceCategoryId}`,
            values
        );
        dispatch(updateResourceCategoryRequest());

        promise.then(
            (updatedResourceCategory: $TSFixMe): void => {
                dispatch(
                    updateResourceCategorySuccess(updatedResourceCategory.data)
                );
            },
            (error: $TSFixMe): void => {
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

export const createResourceCategorySuccess: Function = (
    newResourceCategory: $TSFixMe
): void => {
    return {
        type: types.CREATE_RESOURCE_CATEGORY_SUCCESS,
        payload: newResourceCategory,
    };
};

export const createResourceCategoryRequest: Function = (): void => {
    return {
        type: types.CREATE_RESOURCE_CATEGORY_REQUEST,
    };
};

export const createResourceCategoryFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.CREATE_RESOURCE_CATEGORY_FAILURE,
        payload: error,
    };
};

export const updateResourceCategoryRequest: Function = (): void => {
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

export const updateResourceCategoryFailure: Function = (
    error: ErrorPayload
): void => {
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
        const promise: $TSFixMe =
            delete `resourceCategory/${projectId}/${resourceCategoryId}`;
        dispatch(deleteResourceCategoryRequest(resourceCategoryId));

        promise.then(
            (resourceCategory: $TSFixMe): void => {
                dispatch(
                    deleteResourceCategorySuccess(resourceCategory.data._id)
                );
            },
            (error: $TSFixMe): void => {
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

export const deleteResourceCategoryRequest: Function = (
    resourceCategoryId: $TSFixMe
): void => {
    return {
        type: types.DELETE_RESOURCE_CATEGORY_REQUEST,
        payload: resourceCategoryId,
    };
};

export const deleteResourceCategoryFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.DELETE_RESOURCE_CATEGORY_FAILURE,
        payload: error,
    };
};

export const fetchResourceCategoriesForNewResource: Function = (
    projectId: ObjectID
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `resourceCategory/${projectId}`
        );
        dispatch(fetchResourceCategoriesForNewResourceRequest());

        promise.then(
            (resourceCategories: $TSFixMe): void => {
                dispatch(
                    fetchResourceCategoriesForNewResourceSuccess(
                        resourceCategories.data
                    )
                );
            },
            (error: $TSFixMe): void => {
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

export const fetchResourceCategoriesForNewResourceRequest: Function =
    (): void => {
        return {
            type: types.FETCH_RESOURCE_CATEGORIES_FOR_NEW_RESOURCE_REQUEST,
        };
    };

export const fetchResourceCategoriesForNewResourceFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_RESOURCE_CATEGORIES_FOR_NEW_RESOURCE_FAILURE,
        payload: error,
    };
};
