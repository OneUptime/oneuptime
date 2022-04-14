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
import ObjectID from 'Common/Types/ObjectID';

export const showSearchBar = function (): void {
    return {
        type: SHOW_SEARCH_BAR,
    };
};
export const closeSearchBar = function (): void {
    return {
        type: CLOSE_SEARCH_BAR,
    };
};
export const resetSearch =
    () =>
    async (dispatch: Dispatch): void =>
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
export const search = (projectId: ObjectID, values: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch(searchRequest());
        const promise = BackendAPI.post(`search/${projectId}`, values);
        promise.then(
            (result): void => {
                const search = result.data;
                dispatch(searchSuccess(search.data));
            },
            (error): void => {
                dispatch(searchFailure(error));
            }
        );

        return promise;
    };
};
