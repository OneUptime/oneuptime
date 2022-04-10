import * as types from '../constants/notification';

export const openNotificationMenu = (position: $TSFixMe) => {
    return {
        type: types.OPEN_NOTIFICATION_MENU,
        payload: position,
    };
};
export const closeNotificationMenu = (error: $TSFixMe) => {
    return {
        type: types.CLOSE_NOTIFICATION_MENU,
        payload: error,
    };
};
