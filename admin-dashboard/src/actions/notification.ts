import * as types from '../constants/notification';

export const openNotificationMenu = position => {
    return {
        type: types.OPEN_NOTIFICATION_MENU,
        payload: position,
    };
};
export const closeNotificationMenu = error => {
    return {
        type: types.CLOSE_NOTIFICATION_MENU,
        payload: error,
    };
};
