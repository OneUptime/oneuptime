import {
    RESET_SEARCH_FIELDS,
    POPULATE_SEARCH_REQUEST,
    POPULATE_SEARCH_FAILURE,
    POPULATE_SEARCH_SUCCESS,
    SHOW_SEARCH_BAR,
    CLOSE_SEARCH_BAR,
} from '../constants/search';
import { postApi } from '../api';
import errors from '../errors';

export const showSearchBar = function () {
    return {
        type: SHOW_SEARCH_BAR,
    };
};
export const closeSearchBar = function () {
    return {
        type: CLOSE_SEARCH_BAR,
    };
};
export const resetSearch = () => async (dispatch: $TSFixMe) =>
    dispatch({
        type: RESET_SEARCH_FIELDS,
    });
export const searchRequest = () => {
    return {
        type: POPULATE_SEARCH_REQUEST,
    };
}
export const searchSuccess = (payload: $TSFixMe) => {
    return {
        type: POPULATE_SEARCH_SUCCESS,
        payload,
    };
}
export const searchFailure = (payload: $TSFixMe) => {
    return {
        type: POPULATE_SEARCH_FAILURE,
        payload,
    };
}
export const search = (projectId: $TSFixMe, values: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        dispatch(searchRequest());
        const promise = postApi(`search/${projectId}`, values);
        promise.then(
            function (result) {
                const search = result.data;
                dispatch(searchSuccess(search.data));
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
                dispatch(searchFailure(errors(error)));
            }
        );

        return promise;
    };
}
