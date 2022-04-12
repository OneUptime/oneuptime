import {
    RESET_SEARCH_FIELDS,
    POPULATE_SEARCH_REQUEST,
    POPULATE_SEARCH_FAILURE,
    POPULATE_SEARCH_SUCCESS,
    SHOW_SEARCH_BAR,
    CLOSE_SEARCH_BAR,
} from '../constants/search';
import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';

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
export const resetSearch = () => async (dispatch: Dispatch) =>
    dispatch({
        type: RESET_SEARCH_FIELDS,
    });
export const searchRequest = (): void => {
    return {
        type: POPULATE_SEARCH_REQUEST,
    };
};
export const searchSuccess = (payload: $TSFixMe): void => {
    return {
        type: POPULATE_SEARCH_SUCCESS,
        payload,
    };
};
export const searchFailure = (payload: $TSFixMe): void => {
    return {
        type: POPULATE_SEARCH_FAILURE,
        payload,
    };
};
export const search = (projectId: string, values: $TSFixMe): void => {
    return function (dispatch: Dispatch) {
        dispatch(searchRequest());
        const promise = BackendAPI.post(`search/${projectId}`, values);
        promise.then(
            function (result) {
                const search = result.data;
                dispatch(searchSuccess(search.data));
            },
            function (error) {
                dispatch(searchFailure(error));
            }
        );

        return promise;
    };
};
