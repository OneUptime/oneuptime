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

export const showSearchBar: $TSFixMe = function (): void {
    return {
        type: SHOW_SEARCH_BAR,
    };
};
export const closeSearchBar: $TSFixMe = function (): void {
    return {
        type: CLOSE_SEARCH_BAR,
    };
};
export const resetSearch: $TSFixMe =
    () =>
    async (dispatch: Dispatch): void =>
        dispatch({
            type: RESET_SEARCH_FIELDS,
        });
export const searchRequest: Function = (): void => {
    return {
        type: POPULATE_SEARCH_REQUEST,
    };
};
export const searchSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: POPULATE_SEARCH_SUCCESS,
        payload,
    };
};
export const searchFailure: Function = (payload: $TSFixMe): void => {
    return {
        type: POPULATE_SEARCH_FAILURE,
        payload,
    };
};
export const search: Function = (
    projectId: ObjectID,
    values: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        dispatch(searchRequest());
        const promise: $TSFixMe = BackendAPI.post(
            `search/${projectId}`,
            values
        );
        promise.then(
            (result): void => {
                const search: $TSFixMe = result.data;
                dispatch(searchSuccess(search.data));
            },
            (error: $TSFixMe): void => {
                dispatch(searchFailure(error));
            }
        );

        return promise;
    };
};
