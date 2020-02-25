import {
	getApi, putApi
} from '../api';
import * as types from '../constants/notification'
import errors from '../errors'

import { User } from '../config';

export const openNotificationMenu = function (position) {
	return {
		type: types.OPEN_NOTIFICATION_MENU,
		payload: position
	};
}
export const closeNotificationMenu = function (error) {
	return {
		type: types.CLOSE_NOTIFICATION_MENU,
		payload: error
	};
}

// Create a new project
export function fetchNotificationsRequest() {
	return {
		type: types.FETCH_NOTIFICATIONS_REQUEST
	};
}

export function fetchNotificationsError(error) {
	return {
		type: types.FETCH_NOTIFICATIONS_FAILED,
		payload: error
	};
}

export function fetchNotificationsSuccess(notifications) {
	return {
		type: types.FETCH_NOTIFICATIONS_SUCCESS,
		payload: notifications
	};
}

export const fetchNotificationsReset = () => {
	return {
		type: types.FETCH_NOTIFICATIONS_RESET,
	};
};

export function notificationReadSuccess(notificationId) {
	return {
		type: types.NOTIFICATION_READ_SUCCESS,
		payload: notificationId
	};
}

export function allNotificationReadSuccess(userId) {
	return {
		type: types.ALL_NOTIFICATION_READ_SUCCESS,
		payload: userId
	};
}

// Calls the API to get all notifications.
export function fetchNotifications(projectId) {
	return async function (dispatch) {
		try {
			const notifications = await getApi(`notification/${projectId}`);

			dispatch(fetchNotificationsRequest());
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
			}
			else {
				payload = 'Network Error';
			}

			dispatch(fetchNotificationsError(errors(payload)));
		}
	};
}

export function markAsRead(projectId, notificationId) {
	return async function (dispatch) {
		try {
			const userId = User.getUserId();
			const notifications = await putApi(`notification/${projectId}/${notificationId}/read`);

			dispatch(notificationReadSuccess({ notificationId: notifications.data, userId }));
		} catch (error) {
			let payload;
			if (error && error.response && error.response.data)
				payload = error.response.data;
			if (error && error.data) {
				payload = error.data;
			}
			if (error && error.message) {
				payload = error.message;
			}
			else {
				payload = 'Network Error';
			}

			dispatch(fetchNotificationsError(errors(payload)));
		}
	};
}

export function markAllAsRead(projectId) {
	return async function (dispatch) {
		try {
			const userId = User.getUserId();
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
			}
			else {
				payload = 'Network Error';
			}

			dispatch(fetchNotificationsError(errors(payload)));
		}
	};
}

export function billingActionTaken(projectId, notificationId, values) {
	return async function (dispatch) {
		try {
			const notification = putApi(`notification/${projectId}/${notificationId}`, values);

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
			}
			else {
				payload = 'Network Error';
			}

			dispatch(fetchNotificationsError(errors(payload)));
		}
	};
}