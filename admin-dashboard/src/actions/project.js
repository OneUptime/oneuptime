import { getApi, putApi, deleteApi, postApi } from '../api';
import * as types from '../constants/project';
import errors from '../errors'

export function fetchProjectsRequest() {
	return {
		type: types.FETCH_PROJECTS_REQUEST
	};
}

export function fetchProjectsSuccess(projects) {

	return {
		type: types.FETCH_PROJECTS_SUCCESS,
		payload: projects
	};
}

export function fetchProjectsError(error) {
	return {
		type: types.FETCH_PROJECTS_FAILURE,
		payload: error
	};
}

// Calls the API to fetch all projects.
export function fetchProjects(skip, limit) {
	skip = skip ? parseInt(skip) : 0;
	limit = limit ? parseInt(limit) : 10;
	return function (dispatch) {
		var promise = getApi(`project/projects/allProjects?skip=${skip}&limit=${limit}`);
		dispatch(fetchProjectsRequest());
		promise.then(function (response) {
			var projects = response.data;
			dispatch(fetchProjectsSuccess(projects));

		}, function (error) {

			if (error && error.response && error.response.data)
				error = error.response.data;
			if (error && error.data) {
				error = error.data;
			}
			if(error && error.message){
				error = error.message;
			}
			else{
				error = 'Network Error';
			}
			dispatch(fetchProjectsError(errors(error)));
		});

		return promise;
	};
}

export function fetchUserProjectsRequest() {
	return {
		type: types.FETCH_USER_PROJECTS_REQUEST
	};
}

export function fetchUserProjectsSuccess(users) {

	return {
		type: types.FETCH_USER_PROJECTS_SUCCESS,
		payload: users
	};
}

export function fetchUserProjectsError(error) {
	return {
		type: types.FETCH_USER_PROJECTS_FAILURE,
		payload: error
	};
}

// Calls the API to fetch all user projects.
export function fetchUserProjects(userId, skip, limit) {
	skip = skip ? parseInt(skip) : 0;
	limit = limit ? parseInt(limit) : 10;
	return function (dispatch) {
		var promise = getApi(`project/projects/user/${userId}?skip=${skip}&limit=${limit}`);
		dispatch(fetchUserProjectsRequest());
		promise.then(function (response) {
			var users = response.data;
			dispatch(fetchUserProjectsSuccess(users));

		}, function (error) {

			if (error && error.response && error.response.data)
				error = error.response.data;
			if (error && error.data) {
				error = error.data;
			}
			if(error && error.message){
				error = error.message;
			}
			else{
				error = 'Network Error';
			}
			dispatch(fetchUserProjectsError(errors(error)));
		});

		return promise;
	};
}

//Delete project
export function deleteProjectRequest() {
	return {
		type: types.DELETE_PROJECT_REQUEST,
	};
}

export function deleteProjectReset() {
	return {
		type: types.DELETE_PROJECT_RESET,

	};
}

export function deleteProjectSuccess(project) {

	return {
		type: types.DELETE_PROJECT_SUCCESS,
		payload: project
	};
}

export function deleteProjectError(error) {
	return {
		type: types.DELETE_PROJECT_FAILED,
		payload: error
	};
}

// Calls the API to delete a project
export function deleteProject(projectId) {
	return function (dispatch) {
		var promise;
		promise = deleteApi(`project/${projectId}/deleteProject`);
		dispatch(deleteProjectRequest());
		promise.then(function (response) {
			const data = response.data;
			dispatch(deleteProjectSuccess(data));
		}, function (error) {
			if (error && error.response && error.response.data)
				error = error.response.data;
			if (error && error.data) {
				error = error.data;
			}
			if (error && error.message) {
				error = error.message;
			}
			else{
				error = 'Network Error';
			}
			dispatch(deleteProjectError(errors(error)));
		});
		return promise;
	};
}

//Block project
export function blockProjectRequest() {
	return {
		type: types.BLOCK_PROJECT_REQUEST,
	};
}

export function blockProjectReset() {
	return {
		type: types.BLOCK_PROJECT_RESET,

	};
}

export function blockProjectSuccess(project) {

	return {
		type: types.BLOCK_PROJECT_SUCCESS,
		payload: project
	};
}

export function blockProjectError(error) {
	return {
		type: types.BLOCK_PROJECT_FAILED,
		payload: error
	};
}

// Calls the API to block a project
export function blockProject(projectId) {
	return function (dispatch) {
		var promise;
		promise = putApi(`project/${projectId}/blockProject`);
		dispatch(blockProjectRequest());
		promise.then(function (response) {
			const data = response.data;
			dispatch(blockProjectSuccess(data));
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
			dispatch(blockProjectError(errors(error)));
		});
		return promise;
	};
}

//Restore project
export function restoreProjectRequest() {
	return {
		type: types.RESTORE_PROJECT_REQUEST,
	};
}

export function restoreProjectReset() {
	return {
		type: types.RESTORE_PROJECT_RESET,

	};
}

export function restoreProjectSuccess(project) {

	return {
		type: types.RESTORE_PROJECT_SUCCESS,
		payload: project
	};
}

export function restoreProjectError(error) {
	return {
		type: types.RESTORE_PROJECT_FAILED,
		payload: error
	};
}

// Calls the API to restore a project
export function restoreProject(projectId) {
	return function (dispatch) {
		var promise;
		promise = putApi(`project/${projectId}/restoreProject`);
		dispatch(restoreProjectRequest());
		promise.then(function (response) {
			const data = response.data;
			dispatch(restoreProjectSuccess(data));
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
			dispatch(restoreProjectError(errors(error)));
		});
		return promise;
	};
}

//Unblock project
export function unblockProjectRequest() {
	return {
		type: types.UNBLOCK_PROJECT_REQUEST,
	};
}

export function unblockProjectReset() {
	return {
		type: types.UNBLOCK_PROJECT_RESET,

	};
}

export function unblockProjectSuccess(project) {

	return {
		type: types.UNBLOCK_PROJECT_SUCCESS,
		payload: project
	};
}

export function unblockProjectError(error) {
	return {
		type: types.UNBLOCK_PROJECT_FAILED,
		payload: error
	};
}

// Calls the API to unblock a project
export function unblockProject(projectId) {
	return function (dispatch) {
		var promise;
		promise = putApi(`project/${projectId}/unblockProject`);
		dispatch(unblockProjectRequest());
		promise.then(function (response) {
			const data = response.data;
			dispatch(unblockProjectSuccess(data));
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
			dispatch(unblockProjectError(errors(error)));
		});
		return promise;
	};
}

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

//Search Projects
export function searchProjectsRequest() {
	return {
		type: types.SEARCH_PROJECTS_REQUEST,
	};
}

export function searchProjectsReset() {
	return {
		type: types.SEARCH_PROJECTS_RESET,
	};
}

export function searchProjectsSuccess(projects) {
	return {
		type: types.SEARCH_PROJECTS_SUCCESS,
		payload: projects
	};
}

export function searchProjectsError(error) {
	return {
		type: types.SEARCH_PROJECTS_FAILURE,
		payload: error
	};
}

// Calls the search projects api
export function searchProjects(filter, skip, limit) {
	const values = {
		filter
	};

	return function (dispatch) {
		var promise;
		skip = skip ? parseInt(skip) : 0
		limit = limit ? parseInt(limit) : 10

		promise = postApi(`project/projects/search?skip=${skip}&limit=${limit}`, values);
		
		dispatch(searchProjectsRequest());
		promise.then(function (response) {
			const data = response.data;
			dispatch(searchProjectsSuccess(data));

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
			dispatch(searchProjectsError(errors(error)));
		});
		return promise;
	};
}