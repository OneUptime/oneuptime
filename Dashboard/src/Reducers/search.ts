import {
    POPULATE_SEARCH_SUCCESS,
    POPULATE_SEARCH_REQUEST,
    POPULATE_SEARCH_FAILURE,
    RESET_SEARCH_FIELDS,
    SHOW_SEARCH_BAR,
    CLOSE_SEARCH_BAR,
} from '../constants/search';

import Action from 'CommonUI/src/types/action';

const initialState: $TSFixMe = {
    requesting: false,
    success: false,
    error: null,
    search: [],
    searchFieldVisible: false,
};

export default function search(
    state: $TSFixMe = initialState,
    action: Action
): void {
    switch (action.type) {
        case SHOW_SEARCH_BAR:
            return Object.assign({}, state, {
                searchFieldVisible: true,
            });
        case CLOSE_SEARCH_BAR:
            return Object.assign({}, state, {
                searchFieldVisible: false,
            });
        case POPULATE_SEARCH_SUCCESS:
            return Object.assign({}, state, {
                search: action.payload,
                success: true,
                requesting: false,
                error: null,
            });
        case POPULATE_SEARCH_REQUEST:
            return Object.assign({}, state, {
                success: false,
                error: null,
                requesting: true,
            });
        case POPULATE_SEARCH_FAILURE:
            return Object.assign({}, state, {
                success: false,
                error: action.payload,
                requesting: false,
            });
        case RESET_SEARCH_FIELDS:
            return Object.assign({}, state, {
                search: [],
            });
        default:
            return state;
    }
}
