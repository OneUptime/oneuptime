import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/subProject'
import errors from '../errors'

export function subProjectsRequest(promise) {
	return {
		type: types.SUBPROJECTS_REQUEST,
		payload: promise
	};
}

export function subProjectsError(error) {
	return {
		type: types.SUBPROJECTS_FAILED,
		payload: error
	};
}

export function subProjectsSuccess(subProjects) {
	return {
		type: types.SUBPROJECTS_SUCCESS,
		payload: subProjects
	};
}

export const resetSubProjects = () => {
	return {
		type: types.SUBPROJECTS_RESET,
	};
};

export function getSubProjects(projectId) {

	return function (dispatch) {
		var promise = getApi(`project/${projectId}/subProjects`);
		dispatch(subProjectsRequest(promise));

		promise.then(function (subProjects) {

			dispatch(subProjectsSuccess(subProjects.data));

            subProjects = subProjects.data.data;
            
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
			dispatch(subProjectsError(errors(error)));

		});

		return promise;
	};
}


export function createSubProjectRequest() {
	return {
		type: types.CREATE_SUBPROJECT_REQUEST
	};
}

export function createSubProjectError(error) {
	return {
		type: types.CREATE_SUBPROJECT_FAILED,
		payload: error
	};
}

export function createSubProjectSuccess(subProject) {
	return {
		type: types.CREATE_SUBPROJECT_SUCCESS,
		payload: subProject
	};
}

export const resetCreateSubProject = () => {
	return {
		type: types.CREATE_SUBPROJECT_RESET,
	};
};

export function createSubProject(projectId, values) {

	return function (dispatch) {

		var promise = postApi(`project/${projectId}/subProject`, values.subProjects);

		dispatch(createSubProjectRequest());

		return promise.then(function (subProject) {
			dispatch(createSubProjectSuccess(subProject.data));
			return subProject.data;
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
			dispatch(createSubProjectError(errors(error)));

		});
	};
}

export function resetSubProjectTokenReset() {
	return {
		type: types.RESET_SUBPROJECT_TOKEN_RESET,
	};
}

export function resetSubProjectTokenRequest() {
	return {
		type: types.RESET_SUBPROJECT_TOKEN_REQUEST,
	};
}

export function resetSubProjectTokenSuccess(subProject) {
	return {
		type: types.RESET_SUBPROJECT_TOKEN_SUCCESS,
		payload: subProject.data
	};
}

export function resetSubProjectTokenError(error) {
	return {
		type: types.RESET_SUBPROJECT_TOKEN_FAILED,
		payload: error
	};
}

export function resetSubProjectToken(projectId, subProjectId) {

	return function (dispatch) {

		var promise = getApi(`subProject/${projectId}/${subProjectId}/resetToken`);

		dispatch(resetSubProjectTokenRequest());

		promise.then(function (subProject) {
			dispatch(resetSubProjectTokenSuccess(subProject));

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
			dispatch(resetSubProjectTokenError(errors(error)));

		}).then(function () {
			dispatch(resetSubProjectTokenReset())
		});

		return promise;
	}
}


export function renameSubProjectReset() {
	return {
		type: types.RENAME_SUBPROJECT_RESET,
	};
}

export function renameSubProjectRequest() {
	return {
		type: types.RENAME_SUBPROJECT_REQUEST,
	};
}

export function renameSubProjectSuccess(project) {
	return {
		type: types.RENAME_SUBPROJECT_SUCCESS,
		payload: project.data
	};
}

export function renameSubProjectError(error) {
	return {
		type: types.RENAME_SUBPROJECT_FAILED,
		payload: error
	};
}

export function renameSubProject(projectId, subProjectId, subProjectName) {

	return function (dispatch) {

		var promise = putApi(`subProject/${projectId}/${subProjectId}/rename`, { subProjectName });

		dispatch(renameSubProjectRequest());

		promise.then(function (project) {
			dispatch(renameSubProjectSuccess(project));

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
			dispatch(renameSubProjectError(errors(error)));

		}).then(function () {
			dispatch(renameSubProjectReset())
		});

		return promise;
	}
}


export function deleteSubProjectRequest() {
	return {
		type: types.DELETE_SUBPROJECT_REQUEST,
	};
}

export function deleteSubProjectSuccess(subProjectId) {
	return {
		type: types.DELETE_SUBPROJECT_SUCCESS,
		payload: subProjectId
	};
}

export function deleteSubProjectError(error) {
	return {
		type: types.DELETE_SUBPROJECT_FAILED,
		payload: error
	};
}

export function deleteSubProject(projectId, subProjectId) {

	return function (dispatch) {

		var promise = deleteApi(`subProject/${projectId}/${subProjectId}/deleteProject`, { subProjectId });

		dispatch(deleteSubProjectRequest());

		promise.then(function () {
			dispatch(deleteSubProjectSuccess(subProjectId));

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
			dispatch(deleteSubProjectError(errors(error)));

		});

		return promise;
	}
}

// Calls the API to delete team member.


export function exitSubProjectRequest() {
	return {
		type: types.EXIT_SUBPROJECT_REQUEST
	};
}

export function exitSubProjectSuccess(userId) {

	return {
		type: types.EXIT_SUBPROJECT_SUCCESS,
		payload: userId
	};
}

export function exitSubProjectError(error) {
	return {
		type: types.EXIT_SUBPROJECT_FAILED,
		payload: error
	};
}

export function exitSubProject(projectId, subProjectId, userId) {
	return function (dispatch) {

		var promise = deleteApi(`subProject/${projectId}/${subProjectId}/user/${userId}/exitSubProject`, null);
		dispatch(exitSubProjectRequest());

		promise.then(function () {
			dispatch(exitSubProjectSuccess({ projectId, userId }));

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
			dispatch(exitSubProjectError(errors(error)));
		});

		return promise;
	};
}

export function changeSubProjectRoles(team) {
	return {
		type: types.CHANGE_SUBPROJECT_ROLES,
		payload : team
	};
}

// Calls API to mark project for removal
export function markSubProjectForDeleteRequest() {
	return {
		type: types.MARK_SUBPROJECT_DELETE_REQUEST,
	};
}

export function markSubProjectForDeleteSuccess(subProjectId) {
	return {
		type: types.MARK_SUBPROJECT_DELETE_SUCCESS,
		payload: subProjectId
	};
}

export function markSubProjectForDeleteError(error) {
	return {
		type: types.MARK_SUBPROJECT_DELETE_FAILED,
		payload: error
	};
}

export function markSubProjectForDelete(projectId, subProjectId, feedback) {

	return function (dispatch) {

		var promise = deleteApi(`subProject/${projectId}/${subProjectId}/deleteProject`, { subProjectId, feedback });

		dispatch(markSubProjectForDeleteRequest());

		promise.then(function () {
			dispatch(markSubProjectForDeleteSuccess(projectId));

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
			dispatch(markSubProjectForDeleteError(errors(error)));

		});

		return promise;
	}
}
