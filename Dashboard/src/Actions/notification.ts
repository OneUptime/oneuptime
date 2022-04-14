import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/notification';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import { User } from '../config';

export const openNotificationMenu: $TSFixMe = function (
    position: $TSFixMe
): void {
    return {
        type: types.OPEN_NOTIFICATION_MENU,
        payload: position,
    };
};
export const closeNotificationMenu: $TSFixMe = function (
    error: ErrorPayload
): void {
    return {
        type: types.CLOSE_NOTIFICATION_MENU,
        payload: error,
    };
};

// Create a new project
export const fetchNotificationsRequest: Function = (): void => {
    return {
        type: types.FETCH_NOTIFICATIONS_REQUEST,
    };
};

export const fetchNotificationsError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_NOTIFICATIONS_FAILED,
        payload: error,
    };
};

export const fetchNotificationsSuccess: Function = (
    notifications: $TSFixMe
): void => {
    return {
        type: types.FETCH_NOTIFICATIONS_SUCCESS,
        payload: notifications,
    };
};

export const fetchNotificationsReset: Function = (): void => {
    return {
        type: types.FETCH_NOTIFICATIONS_RESET,
    };
};

export const notificationReadSuccess: Function = (
    notificationId: $TSFixMe
): void => {
    return {
        type: types.NOTIFICATION_READ_SUCCESS,
        payload: notificationId,
    };
};

export const notificationClosedSuccess: Function = (
    notificationId: $TSFixMe
): void => {
    return {
        type: types.NOTIFICATION_CLOSED_SUCCESS,
        payload: notificationId,
    };
};

export const allNotificationReadSuccess: Function = (
    userId: ObjectID
): void => {
    return {
        type: types.ALL_NOTIFICATION_READ_SUCCESS,
        payload: userId,
    };
};

// Calls the API to get all notifications.
export const fetchNotifications: Function = (projectId: ObjectID): void => {
    return async function (dispatch: Dispatch): void {
        try {
            const notifications: $TSFixMe = await BackendAPI.get(
                `notification/${projectId}`
            );

            dispatch(fetchNotificationsRequest());

            dispatch(fetchNotificationsSuccess(notifications.data));
        } catch (error) {
            let payload;
            if (error && error.response && error.response.data) {
                payload = error.response.data;
            }
            if (error && error.data) {
                payload = error.data;
            }
            if (error && error.message) {
                payload = error.message;
            } else {
                payload = 'Network Error';
            }

            dispatch(fetchNotificationsError(payload));
        }
    };
};

export const markAsRead: Function = (
    projectId: ObjectID,
    notificationIds: $TSFixMe
): void => {
    return async function (dispatch: Dispatch): void {
        try {
            const userId: $TSFixMe = User.getUserId();
            notificationIds = notificationIds.map(
                (notification: $TSFixMe) =>
                    notification.notificationId ||
                    notification.notificaitonId._id
            );

            const notifications: $TSFixMe = await BackendAPI.put(
                `notification/${projectId}/read`,
                {
                    notificationIds,
                }
            );

            for (const notificationId of notifications.data) {
                dispatch(
                    notificationReadSuccess({
                        notificationId,
                        userId,
                    })
                );
            }
        } catch (error) {
            let payload;
            if (error && error.response && error.response.data) {
                payload = error.response.data;
            }
            if (error && error.data) {
                payload = error.data;
            }
            if (error && error.message) {
                payload = error.message;
            } else {
                payload = 'Network Error';
            }

            dispatch(fetchNotificationsError(payload));
        }
    };
};

export function closeNotification(
    projectId: ObjectID,
    notificationId: $TSFixMe
): void {
    return async function (dispatch: Dispatch): void {
        try {
            const userId: $TSFixMe = User.getUserId();

            dispatch(
                notificationClosedSuccess({
                    notificationId,
                    userId,
                })
            );

            await BackendAPI.put(
                `notification/${projectId}/${notificationId}/closed`
            );
        } catch (error) {
            let payload;
            if (error && error.response && error.response.data) {
                payload = error.response.data;
            }
            if (error && error.data) {
                payload = error.data;
            }
            if (error && error.message) {
                payload = error.message;
            } else {
                payload = 'Network Error';
            }

            dispatch(fetchNotificationsError(payload));
        }
    };
}

export const markAllAsRead: Function = (projectId: ObjectID): void => {
    return async function (dispatch: Dispatch): void {
        try {
            const userId: $TSFixMe = User.getUserId();

            await BackendAPI.put(`notification/${projectId}/readAll`);

            dispatch(allNotificationReadSuccess(userId));
        } catch (error) {
            let payload;
            if (error && error.response && error.response.data) {
                payload = error.response.data;
            }
            if (error && error.data) {
                payload = error.data;
            }
            if (error && error.message) {
                payload = error.message;
            } else {
                payload = 'Network Error';
            }

            dispatch(fetchNotificationsError(payload));
        }
    };
};

export function billingActionTaken(
    projectId: ObjectID,
    notificationId: $TSFixMe,
    values: $TSFixMe
): void {
    return async function (dispatch: Dispatch): void {
        try {
            const notification: $TSFixMe = BackendAPI.put(
                `notification/${projectId}/${notificationId}`,
                values
            );

            dispatch(notificationReadSuccess(notification));
        } catch (error) {
            let payload;
            if (error && error.response && error.response.data) {
                payload = error.response.data;
            }
            if (error && error.data) {
                payload = error.data;
            }
            if (error && error.message) {
                payload = error.message;
            } else {
                payload = 'Network Error';
            }

            dispatch(fetchNotificationsError(payload));
        }
    };
}

export const resetProjectNotification: Function = (
    projectId: ObjectID
): void => {
    return {
        type: types.RESET_PROJECT_NOTIFICATIONS,
        payload: projectId,
    };
};
