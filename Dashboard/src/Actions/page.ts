import * as types from '../constants/page';
import { Dispatch } from 'redux';

export const pageLoadRequest = function (title: $TSFixMe) {
    return {
        type: types.PAGE_LOAD_REQUEST,
        payload: title,
    };
};
export const pageLoadSuccess = function (title: $TSFixMe) {
    return {
        type: types.PAGE_LOAD_SUCCESS,
        payload: title,
    };
};
export const resetPageLoad = function () {
    return {
        type: types.PAGE_LOAD_RESET,
    };
};

export const loadPage = function (title: $TSFixMe) {
    return function (dispatch: Dispatch) {
        dispatch(pageLoadRequest(title));
        dispatch(pageLoadSuccess(title));
        dispatch(closeSideNav());
    };
};

export const openSideNav = (): void => {
    return {
        type: 'OPEN_SIDENAV',
    };
};

export const closeSideNav = (): void => {
    return {
        type: 'CLOSE_SIDENAV',
    };
};

export const toggleProjectSettingsMore = (payload: $TSFixMe): void => {
    return {
        type: types.TOGGLE_PROJECT_SETTINGS_MORE,
        payload,
    };
};
