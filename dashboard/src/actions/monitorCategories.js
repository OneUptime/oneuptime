import { postApi, getApi, deleteApi } from '../api';
import * as types from '../constants/monitorCategories';
import errors from '../errors';

export function fetchMonitorCategories(projectId, skip, limit) {
    skip = parseInt(skip);
    limit = parseInt(limit);
    return function (dispatch) {
        var promise = null;
        if (skip >= 0 && limit >= 0) {
            promise = getApi(`monitorCategory/${projectId}?skip=${skip}&limit=${limit}`);
        } else {
            promise = getApi(`monitorCategory/${projectId}?skip=${0}&limit=${10}`);
        }
        dispatch(fetchMonitorCategoriesRequest());

        promise.then(function (monitorCategories) {
            dispatch(fetchMonitorCategoriesSuccess(monitorCategories.data));
        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            }
            else {
                error = 'Network Error';
            }
            dispatch(fetchMonitorCategoriesFailure(errors(error)));
        });
        return promise;
    };
}

export function fetchMonitorCategoriesSuccess(monitorCategories) {
    return {
        type: types.FETCH_MONITOR_CATEGORIES_SUCCESS,
        payload: monitorCategories
    };
}

export function fetchMonitorCategoriesRequest() {
    return {
        type: types.FETCH_MONITOR_CATEGORIES_REQUEST,
    };
}

export function fetchMonitorCategoriesFailure(error) {
    return {
        type: types.FETCH_MONITOR_CATEGORIES_FAILURE,
        payload: error
    };
}



export function createMonitorCategory(projectId, values) {

    return function (dispatch) {
        var promise = postApi(`monitorCategory/${projectId}`, values);
        dispatch(createMonitorCategoryRequest());

        promise.then(function (monitorCategory) {
            dispatch(createMonitorCategorySuccess(monitorCategory.data));
        }, function (error) {
            if (error && error.response && error.response.data) {
                error = error.response.data;
            }
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            }
            else {
                error = 'Network Error';
            }
            dispatch(createMonitorCategoryFailure(errors(error)));
        });
        return promise;
    };
}

export function createMonitorCategorySuccess(newMonitorCategory) {
    return {
        type: types.CREATE_MONITOR_CATEGORY_SUCCESS,
        payload: newMonitorCategory
    };
}

export function createMonitorCategoryRequest() {
    return {
        type: types.CREATE_MONITOR_CATEGORY_REQUEST,
    };
}

export function createMonitorCategoryFailure(error) {
    return {
        type: types.CREATE_MONITOR_CATEGORY_FAILURE,
        payload: error
    };
}


export function deleteMonitorCategory(monitorCategoryId, projectId) {
    return function (dispatch) {

        var promise = deleteApi(`monitorCategory/${projectId}/${monitorCategoryId}`);
        dispatch(deleteMonitorCategoryRequest(monitorCategoryId));

        promise.then(function (monitorCategory) {

            dispatch(deleteMonitorCategorySuccess(monitorCategory.data._id));
        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            }
            else {
                error = 'Network Error';
            }
            dispatch(deleteMonitorCategoryFailure({ error: errors(error) }));
        });
        return promise;
    };
}

export function deleteMonitorCategorySuccess(removedMonitorCategoryId) {
    return {
        type: types.DELETE_MONITOR_CATEGORY_SUCCESS,
        payload: removedMonitorCategoryId
    };
}

export function deleteMonitorCategoryRequest(monitorCategoryId) {
    return {
        type: types.DELETE_MONITOR_CATEGORY_REQUEST,
        payload: monitorCategoryId,
    };
}

export function deleteMonitorCategoryFailure(error) {
    return {
        type: types.DELETE_MONITOR_CATEGORY_FAILURE,
        payload: error
    };
}

export function fetchMonitorCategoriesForNewMonitor(projectId) {

    return function (dispatch) {
        var promise = getApi(`monitorCategory/${projectId}`);
        dispatch(fetchMonitorCategoriesForNewMonitorRequest());

        promise.then(function (monitorCategories) {
            dispatch(fetchMonitorCategoriesForNewMonitorSuccess(monitorCategories.data));
        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            }
            else {
                error = 'Network Error';
            }
            dispatch(fetchMonitorCategoriesForNewMonitorFailure(errors(error)));
        });
        return promise;
    };
}

export function fetchMonitorCategoriesForNewMonitorSuccess(monitorCategories) {
    return {
        type: types.FETCH_MONITOR_CATEGORIES_FOR_NEW_MONITOR_SUCCESS,
        payload: monitorCategories
    };
}

export function fetchMonitorCategoriesForNewMonitorRequest() {
    return {
        type: types.FETCH_MONITOR_CATEGORIES_FOR_NEW_MONITOR_REQUEST,
    };
}

export function fetchMonitorCategoriesForNewMonitorFailure(error) {
    return {
        type: types.FETCH_MONITOR_CATEGORIES_FOR_NEW_MONITOR_FAILURE,
        payload: error
    };
}

