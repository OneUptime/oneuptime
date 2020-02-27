import * as types from '../constants/profile';

export const showProfileMenu = () => {
    return {
        type: types.SHOW_PROFILE_MENU,
    };
};

export const hideProfileMenu = error => {
    return {
        type: types.HIDE_PROFILE_MENU,
        payload: error,
    };
};
