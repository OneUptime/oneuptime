import * as types from '../constants/profile';

export const showProfileMenu = (position: $TSFixMe): void => {
    return {
        type: types.SHOW_PROFILE_MENU,
        payload: position,
    };
};

export const hideProfileMenu = (error: $TSFixMe): void => {
    return {
        type: types.HIDE_PROFILE_MENU,
        payload: error,
    };
};
