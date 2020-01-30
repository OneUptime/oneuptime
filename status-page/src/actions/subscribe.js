import { postApi } from '../api';
import errors from '../errors';

export const OPEN_SUBSCRIBE_MENU = 'OPEN_SUBSCRIBE_MENU';
export const SELECTED_MENU = 'SELECTED_MENU';
export const USER_DATA = 'USER_DATA';
export const USER_DATA_RESET = 'USER_DATA_RESET';
export const SUBSCRIBE_SUCCESS = 'SUBSCRIBE_SUCCESS';
export const SUBSCRIBE_REQUEST = 'SUBSCRIBE_REQUEST';
export const SUBSCRIBE_FAILURE = 'SUBSCRIBE_FAILURE';
export const VALIDATION_ERROR = 'VALIDATION_ERROR';

export const openSubscribeMenu = () => {
	return {
		type: OPEN_SUBSCRIBE_MENU
	};
}

export const selectedMenu = (data) => {
	return {
		type: SELECTED_MENU,
		payload: data
	};
}

export const userData = (data) => {
	return {
		type: USER_DATA,
		payload: data
	};
}

export const userDataReset = () => {
	return {
		type: USER_DATA_RESET
	};
}

export const subscribeRequest = () => {
	return {
		type: SUBSCRIBE_REQUEST,
	};
}

export const subscribeSuccess = () => {
	return {
		type: SUBSCRIBE_SUCCESS,
	};
}

export const subscribeFailure = (data) => {
	return {
		type: SUBSCRIBE_FAILURE,
		payload: data
	};
}

export const validationError = (error) => {
	return {
		type: VALIDATION_ERROR,
		payload: error,
	};
}
// Calls the API to get status
export const subscribeUser = (userDetails, monitors, projectId, statusPageId) => {
	return function (dispatch) {
		const promise = postApi(`subscriber/${projectId}/${statusPageId}`, { userDetails, monitors });

		dispatch(subscribeRequest());

		promise.then(() => {
			dispatch(subscribeSuccess());
			dispatch(userDataReset());
			dispatch(selectedMenu(1));
			dispatch(openSubscribeMenu());
		}, (error) => {
			if (error && error.response && error.response.data)
				error = error.response.data;
			if (error && error.data) {
				error = error.data;
			}
			if (error && error.message) {
				error = error.message;
			}
			if (error.length > 100) {
				error = 'Network Error';
			}

			dispatch(subscribeFailure(errors(error)));
		});
	};
}