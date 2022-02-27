import { getApi, putApi } from '../api';
import * as types from '../constants/notification';
import errors from '../errors';

import { User } from '../config';

export const openNotificationMenu = function(position: $TSFixMe) {
    return {
        type: types.OPEN_NOTIFICATION_MENU,
        payload: position,
    };
};
export const closeNotificationMenu = function(error: $TSFixMe) {
    return {
        type: types.CLOSE_NOTIFICATION_MENU,
        payload: error,
    };
};

// Create a new project
export function fetchNotificationsRequest() {
    return {
        type: types.FETCH_NOTIFICATIONS_REQUEST,
    };
}

export function fetchNotificationsError(error: $TSFixMe) {
    return {
        type: types.FETCH_NOTIFICATIONS_FAILED,
        payload: error,
    };
}

export function fetchNotificationsSuccess(notifications: $TSFixMe) {
    return {
        type: types.FETCH_NOTIFICATIONS_SUCCESS,
        payload: notifications,
    };
}

export const fetchNotificationsReset = () => {
    return {
        type: types.FETCH_NOTIFICATIONS_RESET,
    };
};

export function notificationReadSuccess(notificationId: $TSFixMe) {
    return {
        type: types.NOTIFICATION_READ_SUCCESS,
        payload: notificationId,
    };
}

export function notificationClosedSuccess(notificationId: $TSFixMe) {
    return {
        type: types.NOTIFICATION_CLOSED_SUCCESS,
        payload: notificationId,
    };
}

export function allNotificationReadSuccess(userId: $TSFixMe) {
    return {
        type: types.ALL_NOTIFICATION_READ_SUCCESS,
        payload: userId,
    };
}

// Calls the API to get all notifications.
export function fetchNotifications(projectId: $TSFixMe) {
    return async function(dispatch: $TSFixMe) {
        try {
            const notifications = await getApi(`notification/${projectId}`);

            dispatch(fetchNotificationsRequest());
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            dispatch(fetchNotificationsSuccess(notifications.data));
        } catch (error) {
            let payload;
            if (error && error.response && error.response.data)
                payload = error.response.data;
            if (error && error.data) {
                payload = error.data;
            }
            if (error && error.message) {
                payload = error.message;
            } else {
                payload = 'Network Error';
            }

            dispatch(fetchNotificationsError(errors(payload)));
        }
    };
}

export function markAsRead(projectId: $TSFixMe, notificationIds: $TSFixMe) {
    return async function(dispatch: $TSFixMe) {
        try {
            const userId = User.getUserId();
            notificationIds = notificationIds.map(
                (notification: $TSFixMe) =>
                    notification.notificationId ||
                    notification.notificaitonId._id
            );

            const notifications = await putApi(
                `notification/${projectId}/read`,
                { notificationIds }
            );

            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
            if (error && error.response && error.response.data)
                payload = error.response.data;
            if (error && error.data) {
                payload = error.data;
            }
            if (error && error.message) {
                payload = error.message;
            } else {
                payload = 'Network Error';
            }

            dispatch(fetchNotificationsError(errors(payload)));
        }
    };
}

export function closeNotification(
    projectId: $TSFixMe,
    notificationId: $TSFixMe
) {
    return async function(dispatch: $TSFixMe) {
        try {
            const userId = User.getUserId();

            dispatch(
                notificationClosedSuccess({
                    notificationId,
                    userId,
                })
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
            await putApi(`notification/${projectId}/${notificationId}/closed`);
        } catch (error) {
            let payload;
            if (error && error.response && error.response.data)
                payload = error.response.data;
            if (error && error.data) {
                payload = error.data;
            }
            if (error && error.message) {
                payload = error.message;
            } else {
                payload = 'Network Error';
            }

            dispatch(fetchNotificationsError(errors(payload)));
        }
    };
}

export function markAllAsRead(projectId: $TSFixMe) {
    return async function(dispatch: $TSFixMe) {
        try {
            const userId = User.getUserId();
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
            await putApi(`notification/${projectId}/readAll`);

            dispatch(allNotificationReadSuccess(userId));
        } catch (error) {
            let payload;
            if (error && error.response && error.response.data)
                payload = error.response.data;
            if (error && error.data) {
                payload = error.data;
            }
            if (error && error.message) {
                payload = error.message;
            } else {
                payload = 'Network Error';
            }

            dispatch(fetchNotificationsError(errors(payload)));
        }
    };
}

export function billingActionTaken(
    projectId: $TSFixMe,
    notificationId: $TSFixMe,
    values: $TSFixMe
) {
    return async function(dispatch: $TSFixMe) {
        try {
            const notification = putApi(
                `notification/${projectId}/${notificationId}`,
                values
            );

            dispatch(notificationReadSuccess(notification));
        } catch (error) {
            let payload;
            if (error && error.response && error.response.data)
                payload = error.response.data;
            if (error && error.data) {
                payload = error.data;
            }
            if (error && error.message) {
                payload = error.message;
            } else {
                payload = 'Network Error';
            }

            dispatch(fetchNotificationsError(errors(payload)));
        }
    };
}

export function resetProjectNotification(projectId: $TSFixMe) {
    return {
        type: types.RESET_PROJECT_NOTIFICATIONS,
        payload: projectId,
    };
}
