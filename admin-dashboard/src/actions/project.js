import { getApi } from '../api';
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