import BackendAPI from '../api';
import { Dispatch } from 'redux';
import * as types from '../constants/statusPageCategory';

// create status page category
export const createStatusPageCategoryRequest = () => ({
    type: types.CREATE_STATUS_PAGE_CATEGORY_REQUEST,
});

export const createStatusPageCategorySuccess = (payload: $TSFixMe) => ({
    type: types.CREATE_STATUS_PAGE_CATEGORY_SUCCESS,
    payload,
});

export const createStatusPageCategoryFailure = (error: $TSFixMe) => ({
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
                function (response) {
                    dispatch(createStatusPageCategorySuccess(response.data));
                },
                function (error) {

                    dispatch(createStatusPageCategoryFailure(error));
                }
            );
            return promise;
        };

// update status page category
export const updateStatusPageCategoryRequest = () => ({
    type: types.UPDATE_STATUS_PAGE_CATEGORY_REQUEST,
});

export const updateStatusPageCategorySuccess = (payload: $TSFixMe) => ({
    type: types.UPDATE_STATUS_PAGE_CATEGORY_SUCCESS,
    payload,
});

export const updateStatusPageCategoryFailure = (error: $TSFixMe) => ({
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
                function (response) {
                    dispatch(updateStatusPageCategorySuccess(response.data));
                },
                function (error) {

                    dispatch(updateStatusPageCategoryFailure(error));
                }
            );
            return promise;
        };

// fetch status page categories
export const fetchStatusPageCategoriesRequest = () => ({
    type: types.FETCH_STATUS_PAGE_CATEGORIES_REQUEST,
});

export const fetchStatusPageCategoriesSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_STATUS_PAGE_CATEGORIES_SUCCESS,
    payload,
});

export const fetchStatusPageCategoriesFailure = (error: $TSFixMe) => ({
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
                function (response) {
                    dispatch(fetchStatusPageCategoriesSuccess(response.data));
                },
                function (error) {

                    dispatch(fetchStatusPageCategoriesFailure(error));
                }
            );
            return promise;
        };

// fetch  status page categories
export const fetchAllStatusPageCategoriesRequest = () => ({
    type: types.FETCH_ALL_STATUS_PAGE_CATEGORIES_REQUEST,
});

export const fetchAllStatusPageCategoriesSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_ALL_STATUS_PAGE_CATEGORIES_SUCCESS,
    payload,
});

export const fetchAllStatusPageCategoriesFailure = (error: $TSFixMe) => ({
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
                function (response) {
                    dispatch(fetchAllStatusPageCategoriesSuccess(response.data));
                },
                function (error) {

                    dispatch(fetchAllStatusPageCategoriesFailure(error));
                }
            );
            return promise;
        };

// delete status page category
export const deleteStatusPageCategoryRequest = () => ({
    type: types.DELETE_STATUS_PAGE_CATEGORY_REQUEST,
});

export const deleteStatusPageCategorySuccess = (payload: $TSFixMe) => ({
    type: types.DELETE_STATUS_PAGE_CATEGORY_SUCCESS,
    payload,
});

export const deleteStatusPageCategoryFailure = (error: $TSFixMe) => ({
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
                function (response) {
                    dispatch(updateStatusPageCategorySuccess(response.data));
                },
                function (error) {

                    dispatch(updateStatusPageCategoryFailure(error));
                }
            );
            return promise;
        };
