import {
    RESET_SEARCH_FIELDS,
    POPULATE_SEARCH_REQUEST,
    POPULATE_SEARCH_FAILURE,
    POPULATE_SEARCH_SUCCESS,
} from '../constants/search';
import { postApi } from '../api';
import errors from '../errors';

export const resetSearch = () => async dispatch =>
    dispatch({
        type: RESET_SEARCH_FIELDS,
    });
export function searchRequest() {
    return {
        type: POPULATE_SEARCH_REQUEST,
    };
}
export function searchSuccess(payload) {
    return {
        type: POPULATE_SEARCH_SUCCESS,
        payload,
    };
}
export function searchFailure(payload) {
    return {
        type: POPULATE_SEARCH_FAILURE,
        payload,
    };
}
export function search(projectId, values) {
    return function(dispatch) {
        dispatch(searchRequest());
        const promise = postApi(`search/${projectId}`, values);
        promise.then(
            function(result) {
                const search = result.data;
                dispatch(searchSuccess(search.data));
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
                dispatch(searchFailure(errors(error)));
            }
        );

        return promise;
    };
}
