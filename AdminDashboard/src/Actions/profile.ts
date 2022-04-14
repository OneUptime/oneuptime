import * as types from '../constants/profile';

export const showProfileMenu: Function = (position: $TSFixMe): void => {
    return {
        type: types.SHOW_PROFILE_MENU,
        payload: position,
    };
};

export const hideProfileMenu: Function = (error: $TSFixMe): void => {
    return {
        type: types.HIDE_PROFILE_MENU,
        payload: error,
    };
};
