import * as types from '../constants/profile';

export const showProfileMenu = (position: $TSFixMe) => {
    return {
        type: types.SHOW_PROFILE_MENU,
        payload: position,
    };
};

export const hideProfileMenu = (error: $TSFixMe) => {
    return {
        type: types.HIDE_PROFILE_MENU,
        payload: error,
    };
};
