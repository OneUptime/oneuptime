import * as types from '../constants/notification';

export const openNotificationMenu = (position: $TSFixMe): void => {
    return {
        type: types.OPEN_NOTIFICATION_MENU,
        payload: position,
    };
};
export const closeNotificationMenu = (error: $TSFixMe): void => {
    return {
        type: types.CLOSE_NOTIFICATION_MENU,
        payload: error,
    };
};
