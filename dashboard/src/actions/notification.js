import {
	getApi,putApi
} from '../api';
import * as types from '../constants/notification'
import errors from '../errors'

import { User } from '../config';

export const openNotificationMenu = function() {
  return {
    type: types.OPEN_NOTIFICATION_MENU
  };
}
export const closeNotificationMenu = function(error) {
  return {
    type: types.CLOSE_NOTIFICATION_MENU,
    payload : error
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

// Calls the API to get all notifications.
export function fetchNotifications(projectId) {
	return function(dispatch){

		var promise = getApi(`notification/${projectId}`);

		dispatch(fetchNotificationsRequest());

		return promise.then(function(notifications){
			dispatch(fetchNotificationsSuccess(notifications.data));
		}, function(error){
			if(error && error.response && error.response.data)
				error = error.response.data;
			if(error && error.data){
				error = error.data;
			}
			if(error && error.message){
				error = error.message;
			}
			else{
				error = 'Network Error';
			}
			dispatch(fetchNotificationsError(errors(error)));
		});
	};
}

export function markAsRead(projectId,notificationId) {
	return function(dispatch){
		var userId = User.getUserId();
		var promise = putApi(`notification/${projectId}/${notificationId}/read`);
		return promise.then(function(notifications){
			dispatch(notificationReadSuccess({notificationId : notifications.data,userId}));
		}, function(error){
			if(error && error.response && error.response.data)
				error = error.response.data;
			if(error && error.data){
				error = error.data;
			}
			if(error && error.message){
				error = error.message;
			}
			else{
				error = 'Network Error';
			}
			dispatch(fetchNotificationsError(errors(error)));
		});
	};
}

export function billingActionTaken(projectId, notificationId, values) {
	return function(dispatch){
		var promise = putApi(`notification/${projectId}/${notificationId}`, values);
		return promise.then(function(notification){
			dispatch(notificationReadSuccess(notification));
		}, function(error){
			if(error && error.response && error.response.data)
				error = error.response.data;
			if(error && error.data){
				error = error.data;
			}
			if(error && error.message){
				error = error.message;
			}
			else{
				error = 'Network Error';
			}
			dispatch(fetchNotificationsError(errors(error)));
		});
	};
}