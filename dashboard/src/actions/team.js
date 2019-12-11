import { postApi, getApi, deleteApi,putApi } from '../api';
import * as types from '../constants/team'
import errors from '../errors'

export function teamLoadingRequest() {
	return {
		type: types.TEAM_LOADING_REQUEST,

	};
}

export function teamLoadingSuccess(team) {

	return {
		type: types.TEAM_LOADING_SUCCESS,
		payload: team
	};
}

export function teamLoadingError(error) {
	return {
		type: types.TEAM_LOADING_FAILURE,
		payload: error
	};
}

// Calls the API to load team.
export function teamLoading(projectId) {

	return function (dispatch) {

		var promise = getApi(`team/${projectId}`);
		dispatch(teamLoadingRequest());
		promise.then(function (response) {
			var team = response.data;
			dispatch(teamLoadingSuccess(team));

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
			dispatch(teamLoadingError(errors(error)));
		});

		return promise;
	};
}

export function subProjectTeamLoadingRequest() {
	return {
		type: types.TEAM_SUBPROJECT_LOADING_REQUEST,

	};
}

export function subProjectTeamLoadingSuccess(team) {

	return {
		type: types.TEAM_SUBPROJECT_LOADING_SUCCESS,
		payload: team
	};
}

export function subProjectTeamLoadingError(error) {
	return {
		type: types.TEAM_SUBPROJECT_LOADING_FAILURE,
		payload: error
	};
}
// Calls the API to load team.
export function subProjectTeamLoading(projectId) {

	return function (dispatch) {

		var promise = getApi(`team/${projectId}/teamMembers`);
		dispatch(subProjectTeamLoadingRequest());
		promise.then(function (response) {
			var team = response.data;
			dispatch(subProjectTeamLoadingSuccess(team));

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
			dispatch(subProjectTeamLoadingError(errors(error)));
		});

		return promise;
	};
}

// Team create
export function teamCreateRequest() {
	return {
		type: types.TEAM_CREATE_REQUEST,
	};
}

export function teamCreateSuccess(team) {

	return {
		type: types.TEAM_CREATE_SUCCESS,
		payload: team
	};
}

export function teamCreateError(error) {
	return {
		type: types.TEAM_CREATE_FAILURE,
		payload: error
	};
}

// Calls the API to create team members.
export function teamCreate(projectId, values) {
	return function (dispatch) {

		var promise = postApi(`team/${projectId}`, values);
		dispatch(teamCreateRequest());

		promise.then(function (response) {
			var team = response.data;
			dispatch(teamCreateSuccess(team));

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
			dispatch(teamCreateError(errors(error)));
		});

		return promise;
	};
}

export function teamDeleteRequest(id) {
	return {
		type: types.TEAM_DELETE_REQUEST,
		payload: id
	};
}

export function teamDeleteSuccess(team) {
	return {
		type: types.TEAM_DELETE_SUCCESS,
		payload: team
	};
}

export function teamDeleteError(error) {
	return {
		type: types.TEAM_DELETE_FAILURE,
		payload: error
	};
}

export function teamDeleteReset() {
	return {
		type: types.TEAM_DELETE_RESET
	};
}

export function resetTeamDelete(){
	return function(dispatch){
		dispatch(teamDeleteReset());
	}
}

// Calls the API to delete team meber.
export function teamDelete(projectId, teamMemberId) {
	return function (dispatch) {

		var promise = deleteApi(`team/${projectId}/${teamMemberId}`, null);
		dispatch(teamDeleteRequest(teamMemberId));

		promise.then(function (response) {
			var team = response.data;
			dispatch(teamDeleteSuccess(team));
			return {team};
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
			dispatch(teamDeleteError(errors(error)));
			return {error};
		});

		return promise;
	};
}

export function teamUpdateRoleRequest(id) {
	return {
		type: types.TEAM_UPDATE_ROLE_REQUEST,
		payload: id
	};
}

export function teamUpdateRoleSuccess(team) {
	return {
		type: types.TEAM_UPDATE_ROLE_SUCCESS,
		payload: team
	};
}

export function teamUpdateRoleError(error) {
	return {
		type: types.TEAM_UPDATE_ROLE_FAILURE,
		payload: error
	};
}

// Calls the API to update team member role.
export function teamUpdateRole(projectId, values) {
	return function (dispatch) {
		var promise = putApi(`team/${projectId}/${values.teamMemberId}/changerole`, values);
		dispatch(teamUpdateRoleRequest(values.teamMemberId));

		promise.then(function (response) {
			var team = response.data;
			dispatch(teamUpdateRoleSuccess(team));

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
			dispatch(teamUpdateRoleError(errors(error)));
		});

		return promise;
	};
}

// Implements pagination for Team Members table
export function paginateNext(Id) {
	return {
		type: types.PAGINATE_NEXT,
		payload: Id
	};
}

export function paginatePrev(Id) {
	return {
		type: types.PAGINATE_PREV,
		payload: Id
	};
}

export function paginateReset(){
	return {
		type: types.PAGINATE_RESET
	};
}

export function paginate(type,Id){
	return function(dispatch){
		type === 'next' && dispatch(paginateNext(Id));
		type === 'prev' && dispatch(paginatePrev(Id));
		type === 'reset' && dispatch(paginateReset());
	}
}