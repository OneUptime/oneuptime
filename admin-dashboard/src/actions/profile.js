import * as types from '../constants/profile';

export const showProfileMenu = position => {
    return {
        type: types.SHOW_PROFILE_MENU,
        payload: position,
    };
};

export const hideProfileMenu = error => {
    return {
        type: types.HIDE_PROFILE_MENU,
        payload: error,
    };
};
