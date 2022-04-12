import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/statusPageCategory';
import ErrorPayload from 'CommonUI/src/payload-types/error';
// create status page category
export const createStatusPageCategoryRequest = (): void => ({
    type: types.CREATE_STATUS_PAGE_CATEGORY_REQUEST,
});

export const createStatusPageCategorySuccess = (payload: $TSFixMe): void => ({
    type: types.CREATE_STATUS_PAGE_CATEGORY_SUCCESS,
    payload,
});

export const createStatusPageCategoryFailure = (error: ErrorPayload): void => ({
    type: types.CREATE_STATUS_PAGE_CATEGORY_FAILURE,
    payload: error,
});

export const createStatusPageCategory =
    ({ projectId, statusPageId, statusPageCategoryName }: $TSFixMe) =>
    (dispatch: Dispatch) => {
        const promise = BackendAPI.post(
            `statusPageCategory/${projectId}/${statusPageId}`,
            {
                statusPageCategoryName,
            }
        );
        dispatch(createStatusPageCategoryRequest());

        promise.then(
            function (response): void {
                dispatch(createStatusPageCategorySuccess(response.data));
            },
            function (error): void {
                dispatch(createStatusPageCategoryFailure(error));
            }
        );
        return promise;
    };

// update status page category
export const updateStatusPageCategoryRequest = (): void => ({
    type: types.UPDATE_STATUS_PAGE_CATEGORY_REQUEST,
});

export const updateStatusPageCategorySuccess = (payload: $TSFixMe): void => ({
    type: types.UPDATE_STATUS_PAGE_CATEGORY_SUCCESS,
    payload,
});

export const updateStatusPageCategoryFailure = (error: ErrorPayload): void => ({
    type: types.UPDATE_STATUS_PAGE_CATEGORY_FAILURE,
    payload: error,
});

export const updateStatusPageCategory =
    ({ projectId, statusPageCategoryId, statusPageCategoryName }: $TSFixMe) =>
    (dispatch: Dispatch) => {
        const promise = BackendAPI.put(
            `statusPageCategory/${projectId}/${statusPageCategoryId}`,
            {
                statusPageCategoryName,
            }
        );
        dispatch(updateStatusPageCategoryRequest());

        promise.then(
            function (response): void {
                dispatch(updateStatusPageCategorySuccess(response.data));
            },
            function (error): void {
                dispatch(updateStatusPageCategoryFailure(error));
            }
        );
        return promise;
    };

// fetch status page categories
export const fetchStatusPageCategoriesRequest = (): void => ({
    type: types.FETCH_STATUS_PAGE_CATEGORIES_REQUEST,
});

export const fetchStatusPageCategoriesSuccess = (payload: $TSFixMe): void => ({
    type: types.FETCH_STATUS_PAGE_CATEGORIES_SUCCESS,
    payload,
});

export const fetchStatusPageCategoriesFailure = (
    error: ErrorPayload
): void => ({
    type: types.FETCH_STATUS_PAGE_CATEGORIES_FAILURE,
    payload: error,
});

export const fetchStatusPageCategories =
    ({ projectId, statusPageId, skip, limit }: $TSFixMe) =>
    (dispatch: Dispatch) => {
        if (!skip) {
            skip = 0;
        }
        if (!limit) {
            limit = 0;
        }
        const promise = BackendAPI.get(
            `statusPageCategory/${projectId}/${statusPageId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchStatusPageCategoriesRequest());

        promise.then(
            function (response): void {
                dispatch(fetchStatusPageCategoriesSuccess(response.data));
            },
            function (error): void {
                dispatch(fetchStatusPageCategoriesFailure(error));
            }
        );
        return promise;
    };

// fetch  status page categories
export const fetchAllStatusPageCategoriesRequest = (): void => ({
    type: types.FETCH_ALL_STATUS_PAGE_CATEGORIES_REQUEST,
});

export const fetchAllStatusPageCategoriesSuccess = (
    payload: $TSFixMe
): void => ({
    type: types.FETCH_ALL_STATUS_PAGE_CATEGORIES_SUCCESS,
    payload,
});

export const fetchAllStatusPageCategoriesFailure = (
    error: ErrorPayload
): void => ({
    type: types.FETCH_ALL_STATUS_PAGE_CATEGORIES_FAILURE,
    payload: error,
});

export const fetchAllStatusPageCategories =
    ({ projectId, statusPageId, skip, limit }: $TSFixMe) =>
    (dispatch: Dispatch) => {
        if (!skip) {
            skip = 0;
        }
        if (!limit) {
            limit = 0;
        }
        const promise = BackendAPI.get(
            `statusPageCategory/${projectId}/${statusPageId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchAllStatusPageCategoriesRequest());

        promise.then(
            function (response): void {
                dispatch(fetchAllStatusPageCategoriesSuccess(response.data));
            },
            function (error): void {
                dispatch(fetchAllStatusPageCategoriesFailure(error));
            }
        );
        return promise;
    };

// delete status page category
export const deleteStatusPageCategoryRequest = (): void => ({
    type: types.DELETE_STATUS_PAGE_CATEGORY_REQUEST,
});

export const deleteStatusPageCategorySuccess = (payload: $TSFixMe): void => ({
    type: types.DELETE_STATUS_PAGE_CATEGORY_SUCCESS,
    payload,
});

export const deleteStatusPageCategoryFailure = (error: ErrorPayload): void => ({
    type: types.DELETE_STATUS_PAGE_CATEGORY_FAILURE,
    payload: error,
});

export const deleteStatusPageCategory =
    ({ projectId, statusPageCategoryId }: $TSFixMe) =>
    (dispatch: Dispatch) => {
        const promise =
            delete `statusPageCategory/${projectId}/${statusPageCategoryId}`;
        dispatch(updateStatusPageCategoryRequest());

        promise.then(
            function (response): void {
                dispatch(updateStatusPageCategorySuccess(response.data));
            },
            function (error): void {
                dispatch(updateStatusPageCategoryFailure(error));
            }
        );
        return promise;
    };
