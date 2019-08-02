import {
    deleteApi,
    getApi,
	postApi,
	putApi
} from '../api';
import * as types from '../constants/webHook';

export function deleteWebHookRequest() {
	return {
		type: types.DELETE_WEB_HOOK_REQUEST
	};
}

export function deleteWebHookError(error) {
	return {
		type: types.DELETE_WEB_HOOK_FAILED,
		payload: error
	};
}

export function deleteWebHookSuccess(deleteWebHook) {
	return {
		type: types.DELETE_WEB_HOOK_SUCCESS,
		payload: deleteWebHook
	};
}

export const resetDeleteWebHook = () => {
	return {
		type: types.DELETE_WEB_HOOK_RESET,
	};
};


// Calls the API to link webhook team to project
export function deleteWebHook(projectId, webhookId) {
	return function (dispatch) {

		var promise = deleteApi(`webhook/${projectId}/delete/${webhookId}`, null);

		dispatch(deleteWebHookRequest());

		return promise.then(function (webhook) {

			dispatch(deleteWebHookSuccess(webhook.data));
			return webhook.data;
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
			dispatch(deleteWebHookError(error));
		});
	};
}


export function getWebHookRequest(promise) {
	return {
		type: types.GET_WEB_HOOK_REQUEST,
		payload: promise
	};
}

export function getWebHookError(error) {
	return {
		type: types.GET_WEB_HOOK_FAILED,
		payload: error
	};
}

export function getWebHookSuccess(webhooks) {
	return {
		type: types.GET_WEB_HOOK_SUCCESS,
		payload: webhooks
	};
}

export const resetGetWebHook = () => {
	return {
		type: types.GET_WEB_HOOK_RESET,
	};
};

export function getWebHook(projectId, skip, limit) {

	return function (dispatch) {
        var promise = null;
            promise = getApi(`webhook/${projectId}/hooks?skip=${skip || 0}&limit=${limit || 10}`);
        dispatch(getWebHookRequest(promise));

		promise.then(function (webhooks) {
            dispatch(getWebHookSuccess(webhooks.data));

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
			dispatch(getWebHookError(error));

		});

		return promise;
	};
}

export function createWebHookRequest() {
	return {
		type: types.CREATE_WEB_HOOK_REQUEST
	};
}

export function createWebHookError(error) {
	return {
		type: types.CREATE_WEB_HOOK_FAILED,
		payload: error
	};
}

export function createWebHookSuccess(newWebHook) {
	return {
		type: types.CREATE_WEB_HOOK_SUCCESS,
		payload: newWebHook
	};
}

export const resetCreateWebHook = () => {
	return {
		type: types.CREATE_WEB_HOOK_RESET,
	};
};


// Calls the API to add webhook to project
export function createWebHook(projectId, data) {
	return function (dispatch) {

		var promise = postApi(`webhook/${projectId}/create`, data);

		dispatch(createWebHookRequest());

		return promise.then(function (webhook) {
			dispatch(createWebHookSuccess(webhook.data));
			return webhook.data;
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
			dispatch(createWebHookError(error));
		});
	};
}


export function updateWebHookRequest() {
	return {
		type: types.UPDATE_WEB_HOOK_REQUEST
	};
}

export function updateWebHookError(error) {
	return {
		type: types.UPDATE_WEB_HOOK_FAILED,
		payload: error
	};
}

export function updateWebHookSuccess(newWebHook) {
	return {
		type: types.UPDATE_WEB_HOOK_SUCCESS,
		payload: newWebHook
	};
}

export const resetUpdateWebHook = () => {
	return {
		type: types.UPDATE_WEB_HOOK_RESET,
	};
};


// Calls the API to add webhook to project
export function updateWebHook(projectId, webhookId, data) {
	return function (dispatch) {

		var promise = putApi(`webhook/${projectId}/${webhookId}`, data);

		dispatch(updateWebHookRequest());

		return promise.then(function (webhook) {
			dispatch(updateWebHookSuccess(webhook.data));
			return webhook.data;
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
			dispatch(updateWebHookError(error));
		});
	};
}

// Implements pagination for Webhooks Members table

export function paginateNext() {
	return {
		type: types.PAGINATE_NEXT
	};
}

export function paginatePrev() {
	return {
		type: types.PAGINATE_PREV
	};
}

export function paginateReset(){
	return {
		type: types.PAGINATE_RESET
	};
}

export function paginate(type){
	return function(dispatch){
		type === 'next' && dispatch(paginateNext());
		type === 'prev' && dispatch(paginatePrev());
		type === 'reset' && dispatch(paginateReset());
	}
}