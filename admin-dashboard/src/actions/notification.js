import * as types from '../constants/notification';

export const openNotificationMenu = () => {
    return {
        type: types.OPEN_NOTIFICATION_MENU,
    };
};
export const closeNotificationMenu = error => {
    return {
        type: types.CLOSE_NOTIFICATION_MENU,
        payload: error,
    };
};
