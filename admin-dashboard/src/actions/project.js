import { getApi, putApi, deleteApi, postApi } from '../api';
import * as types from '../constants/project';
import errors from '../errors'

  // Fetch Projects

  export const fetchProjectsRequest = () => {
    return {
      type: types.FETCH_PROJECTS_REQUEST,
    }
  }
  
  export const fetchProjectsSuccess = projects => {
    return {
      type: types.FETCH_PROJECTS_SUCCESS,
      payload: projects,
    }
  }
  
  export const fetchProjectsError = error => {
    return {
      type: types.FETCH_PROJECTS_FAILURE,
      payload: error,
    }
  }

// Calls the API to fetch all projects.
export const fetchProjects = (skip, limit) => async (dispatch) => {
	skip = skip ? parseInt(skip) : 0;
	limit = limit ? parseInt(limit) : 10;

	dispatch(fetchProjectsRequest())

	try{
		const response = await getApi(`project/projects/allProjects?skip=${skip}&limit=${limit}`);
		
		dispatch(fetchProjectsSuccess(response.data));
		return response;
	}catch(error){
		let errorMsg;
		if (error && error.response && error.response.data)
			errorMsg = error.response.data;
		if (error && error.data) {
			errorMsg = error.data;
		}
		if(error && error.message){
			errorMsg = error.message;
		}
		else{
			errorMsg = 'Network Error';
		}
		dispatch(fetchProjectsError(errors(errorMsg)));
	}
}

export const fetchUserProjectsRequest = () => {
	return {
		type: types.FETCH_USER_PROJECTS_REQUEST
	};
}

export const fetchUserProjectsSuccess = users => {
	return {
		type: types.FETCH_USER_PROJECTS_SUCCESS,
		payload: users
	};
}

export const fetchUserProjectsError = error => {
	return {
		type: types.FETCH_USER_PROJECTS_FAILURE,
		payload: error
	};
}

// Calls the API to fetch all user projects.
export const fetchUserProjects = (userId, skip, limit) => async (dispatch) => {
	skip = skip ? parseInt(skip) : 0;
	limit = limit ? parseInt(limit) : 10;

	dispatch(fetchUserProjectsRequest());

	try{
		const response = await getApi(`project/projects/user/${userId}?skip=${skip}&limit=${limit}`);
		const users = response.data;

		dispatch(fetchProjectsSuccess(users));
		return response;
	}catch(error){
		let errorMsg;
		if (error && error.response && error.response.data)
			errorMsg = error.response.data;
		if (error && error.data) {
			errorMsg = error.data;
		}
		if(error && error.message){
			errorMsg = error.message;
		}
		else{
			errorMsg = 'Network Error';
		}
		dispatch(fetchProjectsError(errors(errorMsg)));
	}
}

//Delete project
export const deleteProjectRequest = () => {
	return {
		type: types.DELETE_PROJECT_REQUEST,
	};
}

export const deleteProjectReset = () => {
	return {
		type: types.DELETE_PROJECT_RESET,
	};
}

export const deleteProjectSuccess = project => {
	return {
		type: types.DELETE_PROJECT_SUCCESS,
		payload: project
	};
}

export const deleteProjectError = error => {
	return {
		type: types.DELETE_PROJECT_FAILED,
		payload: error
	};
}

// Calls the API to delete a project
export const deleteProject = projectId => async (dispatch) => {

	dispatch(deleteProjectRequest());

	try{
		const response = await deleteApi(`project/${projectId}/deleteProject`);
		const data = response.data;

		dispatch(deleteProjectSuccess(data));
		return response;
	}catch(error){
		let errorMsg;
		if (error && error.response && error.response.data)
			errorMsg = error.response.data;
		if (error && error.data) {
			errorMsg = error.data;
		}
		if(error && error.message){
			errorMsg = error.message;
		}
		else{
			errorMsg = 'Network Error';
		}
		dispatch(deleteProjectError(errors(errorMsg)));
	}
}

//Block project
export const blockProjectRequest = () => {
	return {
		type: types.BLOCK_PROJECT_REQUEST,
	};
}

export const blockProjectReset = () => {
	return {
		type: types.BLOCK_PROJECT_RESET,
	};
}

export const blockProjectSuccess = project => {
	return {
		type: types.BLOCK_PROJECT_SUCCESS,
		payload: project
	};
}

export const blockProjectError = error => {
	return {
		type: types.BLOCK_PROJECT_FAILED,
		payload: error
	};
}

// Calls the API to block a project
export const blockProject = projectId => async (dispatch) => {

	dispatch(blockProjectRequest());

	try{
		const response = await putApi(`project/${projectId}/blockProject`);
		const data = response.data;

		dispatch(blockProjectSuccess(data));
		return response;
	}catch(error){
		let errorMsg;
		if (error && error.response && error.response.data)
			errorMsg = error.response.data;
		if (error && error.data) {
			errorMsg = error.data;
		}
		if(error && error.message){
			errorMsg = error.message;
		}
		else{
			errorMsg = 'Network Error';
		}
		dispatch(blockProjectError(errors(errorMsg)));
	}
}

//Restore project
export const restoreProjectRequest = () => {
	return {
		type: types.RESTORE_PROJECT_REQUEST,
	};
}

export const restoreProjectReset = () => {
	return {
		type: types.RESTORE_PROJECT_RESET,
	};
}

export const restoreProjectSuccess = project => {
	return {
		type: types.RESTORE_PROJECT_SUCCESS,
		payload: project
	};
}

export const restoreProjectError = error => {
	return {
		type: types.RESTORE_PROJECT_FAILED,
		payload: error
	};
}

// Calls the API to restore a project
export const restoreProject = projectId => async (dispatch) => {

	dispatch(restoreProjectRequest());

	try{
		const response = await putApi(`project/${projectId}/restoreProject`);
		const data = response.data;

		dispatch(restoreProjectSuccess(data));
		return response;
	}catch(error){
		let errorMsg;
		if (error && error.response && error.response.data)
			errorMsg = error.response.data;
		if (error && error.data) {
			errorMsg = error.data;
		}
		if(error && error.message){
			errorMsg = error.message;
		}
		else{
			errorMsg = 'Network Error';
		}
		dispatch(restoreProjectError(errors(errorMsg)));
	}
}

//Unblock project
export const unblockProjectRequest = () => {
	return {
		type: types.UNBLOCK_PROJECT_REQUEST,
	};
}

export const unblockProjectReset = () => {
	return {
		type: types.UNBLOCK_PROJECT_RESET,
	};
}

export const unblockProjectSuccess = (project) => {
	return {
		type: types.UNBLOCK_PROJECT_SUCCESS,
		payload: project
	};
}

export const unblockProjectError = (error) => {
	return {
		type: types.UNBLOCK_PROJECT_FAILED,
		payload: error
	};
}

// Calls the API to un-block a project
export const unblockProject = projectId => async (dispatch) => {

	dispatch(unblockProjectRequest());

	try{
		const response = await putApi(`project/${projectId}/unblockProject`);
		const data = response.data;

		dispatch(unblockProjectSuccess(data));
		return response;
	}catch(error){
		let errorMsg;
		if (error && error.response && error.response.data)
			errorMsg = error.response.data;
		if (error && error.data) {
			errorMsg = error.data;
		}
		if(error && error.message){
			errorMsg = error.message;
		}
		else{
			errorMsg = 'Network Error';
		}
		dispatch(unblockProjectError(errors(errorMsg)));
	}
}

//Add Project Notes
export const addProjectNoteRequest = () => {
	return {
		type: types.ADD_PROJECT_NOTE_REQUEST,
	};
}

export const addProjectNoteReset = () => {
	return {
		type: types.ADD_PROJECT_NOTE_RESET,
	};
}

export const addProjectNoteSuccess = projectNote => {
	return {
		type: types.ADD_PROJECT_NOTE_SUCCESS,
		payload: projectNote
	};
}

export const addProjectNoteError = error => {
	return {
		type: types.ADD_PROJECT_NOTE_FAILURE,
		payload: error
	};
}

// Calls the API to add Admin Note
export const addProjectNote = (projectId, values) => async (dispatch) => {

	dispatch(addProjectNoteRequest());

	try{
		const response = await postApi(`project/${projectId}/addNote`, values);
		const data = response.data;

		dispatch(addProjectNoteSuccess(data));
		return response;
	}catch(error){
		let errorMsg;
		if (error && error.response && error.response.data)
			errorMsg = error.response.data;
		if (error && error.data) {
			errorMsg = error.data;
		}
		if(error && error.message){
			errorMsg = error.message;
		}
		else{
			errorMsg = 'Network Error';
		}
		dispatch(addProjectNoteError(errors(errorMsg)));
	}
}

//Search Projects
export const searchProjectsRequest = () => {
	return {
		type: types.SEARCH_PROJECTS_REQUEST,
	};
}

export const searchProjectsReset = () => {
	return {
		type: types.SEARCH_PROJECTS_RESET,
	};
}

export const searchProjectsSuccess = projects => {
	return {
		type: types.SEARCH_PROJECTS_SUCCESS,
		payload: projects
	};
}

export const searchProjectsError = error => {
	return {
		type: types.SEARCH_PROJECTS_FAILURE,
		payload: error
	};
}

// Calls the search projects api
export const searchProjects = (filter, skip, limit) => async (dispatch) => {
	const values = {
		filter
	};

	dispatch(searchProjectsRequest());

	try{
		const response = await postApi(`project/projects/search?skip=${skip}&limit=${limit}`, values);
		const data = response.data;

		dispatch(searchProjectsSuccess(data));
		return response;
	}catch(error){
		let errorMsg;
		if (error && error.response && error.response.data)
			errorMsg = error.response.data;
		if (error && error.data) {
			errorMsg = error.data;
		}
		if(error && error.message){
			errorMsg = error.message;
		}
		else{
			errorMsg = 'Network Error';
		}
		dispatch(searchProjectsError(errors(errorMsg)));
	}
}