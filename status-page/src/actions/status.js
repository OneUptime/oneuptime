import { getApi, postApi } from '../api';
import errors from '../errors';
import {
	loginRequired, loginError,
} from '../actions/login';

export const STATUSPAGE_REQUEST = 'STATUSPAGE_REQUEST';
export const STATUSPAGE_SUCCESS = 'STATUSPAGE_SUCCESS';
export const STATUSPAGE_FAILURE = 'STATUSPAGE_FAILURE';

export const statusPageSuccess = (data) => {
	return {
		type: STATUSPAGE_SUCCESS,
		payload: data
	};
}

export const statusPageRequest = () => {
	return {
		type: STATUSPAGE_REQUEST
	};
}

export const statusPageFailure = (error) => {
	return {
		type: STATUSPAGE_FAILURE,
		payload: error
	};
}

// Calls the API to get status
export const getStatusPage = (statusPageId, url) => {
	return function (dispatch) {
		const promise = getApi(`statusPage/${statusPageId}?url=${url}`);

		dispatch(statusPageRequest());

		promise.then((Data) => {
			dispatch(statusPageSuccess(Data.data));
		}, (error) => {
			if (error && error.response && error.response.status && error.response.status === 401) {
				dispatch(loginRequired(statusPageId));
			}
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
			dispatch(statusPageFailure(errors(error)));
			dispatch(loginError(errors(error)));
		});
		return promise;
	};
}

export const STATUSPAGE_NOTES_REQUEST = 'STATUSPAGE_NOTES_REQUEST';
export const STATUSPAGE_NOTES_SUCCESS = 'STATUSPAGE_NOTES_SUCCESS';
export const STATUSPAGE_NOTES_FAILURE = 'STATUSPAGE_NOTES_FAILURE';
export const STATUSPAGE_NOTES_RESET = 'STATUSPAGE_NOTES_RESET';
export const INDIVIDUAL_NOTES_ENABLE = 'INDIVIDUAL_NOTES_ENABLE';
export const INDIVIDUAL_NOTES_DISABLE = 'INDIVIDUAL_NOTES_DISABLE';

export const statusPageNoteSuccess = (data) => {
	return {
		type: STATUSPAGE_NOTES_SUCCESS,
		payload: data
	};
}

export const statusPageNoteRequest = () => {
	return {
		type: STATUSPAGE_NOTES_REQUEST
	};
}

export const statusPageNoteFailure = (error) => {
	return {
		type: STATUSPAGE_NOTES_FAILURE,
		payload: error
	};
}

export const statusPageNoteReset = () => {
	return {
		type: STATUSPAGE_NOTES_RESET
	};
}

export const individualNoteEnable = (message) => {
	return {
		type: INDIVIDUAL_NOTES_ENABLE,
		payload: message
	};
}
export const individualNoteDisable = () => {
	return {
		type: INDIVIDUAL_NOTES_DISABLE
	};
}

// Calls the API to get status
export const getStatusPageNote = (projectId, statusPageId, skip) => {
	return function (dispatch) {
		const promise = getApi(`statusPage/${projectId}/${statusPageId}/notes?skip=${skip}`);

		dispatch(statusPageNoteRequest());

		promise.then((Data) => {
			dispatch(statusPageNoteSuccess(Data.data));
			dispatch(individualNoteDisable());
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
			dispatch(statusPageNoteFailure(errors(error)));
		});
	};
}

export const getStatusPageIndividualNote = (projectId, monitorId, date, name, need) => {
	return function (dispatch) {
		const promise = getApi(`statusPage/${projectId}/${monitorId}/individualnotes?date=${date}&need=${need}`);

		dispatch(statusPageNoteRequest());

		promise.then((Data) => {
			dispatch(statusPageNoteSuccess(Data.data));
			dispatch(individualNoteEnable({
				message: Data.data.message,
				name: {
					_id: monitorId,
					name,
					date
				}
			}));
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
			dispatch(statusPageNoteFailure(errors(error)));
		});
	};
}

export const notmonitoredDays = (monitorId, date, name, message) => {
	return function (dispatch) {
		dispatch(statusPageNoteReset());
		dispatch(individualNoteEnable({
			message: message,
			name: {
				_id: monitorId,
				name,
				date
			}
		}));
	};
}

export const MORE_NOTES_REQUEST = 'MORE_NOTES_REQUEST';
export const MORE_NOTES_SUCCESS = 'MORE_NOTES_SUCCESS';
export const MORE_NOTES_FAILURE = 'MORE_NOTES_FAILURE';

export const moreNoteSuccess = (data) => {
	return {
		type: MORE_NOTES_SUCCESS,
		payload: data
	};
}

export const moreNoteRequest = () => {
	return {
		type: MORE_NOTES_REQUEST
	};
}

export const moreNoteFailure = (error) => {
	return {
		type: MORE_NOTES_FAILURE,
		payload: error
	};
}

export const getMoreNote = (projectId, statusPageId, skip) => {
	return function (dispatch) {
		const promise = getApi(`statusPage/${projectId}/${statusPageId}/notes?skip=${skip}`);

		dispatch(moreNoteRequest());
		promise.then((Data) => {
			dispatch(moreNoteSuccess(Data.data));
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
			dispatch(moreNoteFailure(errors(error)));
		});
	};
}

export const SELECT_PROBE = 'SELECT_PROBE';

export function selectedProbe(val) {
	return function (dispatch) {
		dispatch({
			type: SELECT_PROBE,
			payload: val
		});
	};
}

// Fetch Monitor Statuses
export const FETCH_MONITOR_STATUSES_REQUEST = 'FETCH_MONITOR_STATUSES_REQUEST';
export const FETCH_MONITOR_STATUSES_SUCCESS = 'FETCH_MONITOR_STATUSES_SUCCESS';
export const FETCH_MONITOR_STATUSES_FAILURE = 'FETCH_MONITOR_STATUSES_FAILURE';

// Fetch Monitor Statuses list
export function fetchMonitorStatuses(projectId, monitorId, startDate, endDate) {
	return function (dispatch) {
		var promise = postApi(`statusPage/${projectId}/${monitorId}/monitorStatuses`, { startDate, endDate });
		dispatch(fetchMonitorStatusesRequest());

		promise.then(function (monitorStatuses) {
			dispatch(fetchMonitorStatusesSuccess({ projectId, monitorId, statuses: monitorStatuses.data }));
		}, function (error) {
			if (error && error.response && error.response.data) {
				error = error.response.data;
			}
			if (error && error.data) {
				error = error.data;
			}
			if (error && error.message) {
				error = error.message;
			}
			else {
				error = 'Network Error';
			}
			dispatch(fetchMonitorStatusesFailure(errors(error)));
		});

		return promise;
	};
}

export function fetchMonitorStatusesRequest() {
	return {
		type: FETCH_MONITOR_STATUSES_REQUEST,
	};
}

export function fetchMonitorStatusesSuccess(monitorStatuses) {
	return {
		type: FETCH_MONITOR_STATUSES_SUCCESS,
		payload: monitorStatuses
	};
}

export function fetchMonitorStatusesFailure(error) {
	return {
		type: FETCH_MONITOR_STATUSES_FAILURE,
		payload: error
	};
}