import { getApi, putApi, deleteApi, postApi } from '../api';
import * as types from '../constants/adminNote';
import errors from '../errors'

//Add Project Notes
export function addProjectNoteRequest() {
	return {
		type: types.ADD_PROJECT_NOTE_REQUEST,
	};
}

export function addProjectNoteReset() {
	return {
		type: types.ADD_PROJECT_NOTE_RESET,
	};
}

export function addProjectNoteSuccess(projectNote) {
	return {
		type: types.ADD_PROJECT_NOTE_SUCCESS,
		payload: projectNote
	};
}

export function addProjectNoteError(error) {
	return {
		type: types.ADD_PROJECT_NOTE_FAILURE,
		payload: error
	};
}

// Calls the API to add Admin Note
export function addProjectNote(projectId, values) {
	return function (dispatch) {
		var promise;
		promise = postApi(`project/${projectId}/addNote`, values);
		dispatch(addProjectNoteRequest());
		promise.then(function (response) {
			const data = response.data;
			dispatch(addProjectNoteSuccess(data));
		}, function (error) {
			if (error && error.response && error.response.data)
				error = error.response.data;
			if (error && error.data) {
				error = error.data;
			}
			if (error && error.message) {
				error = error.message;
			}else{
				error = 'Network Error';
			}
			dispatch(addProjectNoteError(errors(error)));
		});
		return promise;
	};
}