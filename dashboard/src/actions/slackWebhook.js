import { deleteApi, getApi, postApi, putApi } from '../api';
import * as types from '../constants/slackWebhooks';

export function deleteSlackRequest() {
    return {
        type: types.DELETE_SLACK_WEBHOOK_REQUEST,
    };
}

export function deleteSlackError(error) {
    return {
        type: types.DELETE_SLACK_WEBHOOK_FAILED,
        payload: error,
    };
}

export function deleteSlackSuccess(deleteSlack) {
    return {
        type: types.DELETE_SLACK_WEBHOOK_SUCCESS,
        payload: deleteSlack,
    };
}

export const resetDeleteSlack = () => {
    return {
        type: types.DELETE_SLACK_WEBHOOK_RESET,
    };
};

// Calls the API to link webhook team to project
export function deleteSlack(projectId, msTeamsId) {
    return function(dispatch) {
        const promise = deleteApi(
            `webhook/${projectId}/delete/${msTeamsId}`,
            null
        );

        dispatch(deleteSlackRequest());

        return promise.then(
            function(msTeams) {
                dispatch(deleteSlackSuccess(msTeams.data));
                return msTeams.data;
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(deleteSlackError(error));
            }
        );
    };
}

export function getSlackRequest(promise) {
    return {
        type: types.GET_SLACK_WEBHOOK_REQUEST,
        payload: promise,
    };
}

export function getSlackError(error) {
    return {
        type: types.GET_SLACK_WEBHOOK_FAILED,
        payload: error,
    };
}

export function getSlackSuccess(msTeams) {
    return {
        type: types.GET_SLACK_WEBHOOK_SUCCESS,
        payload: msTeams,
    };
}

export const resetGetSlack = () => {
    return {
        type: types.GET_SLACK_WEBHOOK_RESET,
    };
};

export function getSlack(projectId, skip, limit) {
    return function(dispatch) {
        let promise = null;
        promise = getApi(
            `webhook/${projectId}/hooks?skip=${skip || 0}&limit=${limit ||
                10}&type=slack`
        );
        dispatch(getSlackRequest(promise));

        promise.then(
            function(webhooks) {
                dispatch(getSlackSuccess(webhooks.data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(getSlackError(error));
            }
        );

        return promise;
    };
}

export function createSlackRequest() {
    return {
        type: types.CREATE_SLACK_WEBHOOK_REQUEST,
    };
}

export function createSlackError(error) {
    return {
        type: types.CREATE_SLACK_WEBHOOK_FAILED,
        payload: error,
    };
}

export function createSlackSuccess(newWebHook) {
    return {
        type: types.CREATE_SLACK_WEBHOOK_SUCCESS,
        payload: newWebHook,
    };
}

export const resetCreateSlack = () => {
    return {
        type: types.CREATE_SLACK_WEBHOOK_RESET,
    };
};

// Calls the API to add webhook to project
export function createSlack(projectId, data) {
    return function(dispatch) {
        const promise = postApi(`webhook/${projectId}/create`, data);

        dispatch(createSlackRequest());

        return promise.then(
            function(webhook) {
                dispatch(createSlackSuccess(webhook.data));
                return webhook.data;
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(createSlackError(error));
            }
        );
    };
}

export function updateSlackRequest() {
    return {
        type: types.UPDATE_SLACK_WEBHOOK_REQUEST,
    };
}

export function updateSlackError(error) {
    return {
        type: types.UPDATE_SLACK_WEBHOOK_FAILED,
        payload: error,
    };
}

export function updateSlackSuccess(newWebHook) {
    return {
        type: types.UPDATE_SLACK_WEBHOOK_SUCCESS,
        payload: newWebHook,
    };
}

export const resetUpdateSlack = () => {
    return {
        type: types.UPDATE_SLACK_WEBHOOK_RESET,
    };
};

// Calls the API to add webhook to project
export function updateSlack(projectId, webhookId, data) {
    return function(dispatch) {
        const promise = putApi(`webhook/${projectId}/${webhookId}`, data);

        dispatch(updateSlackRequest());

        return promise.then(
            function(webhook) {
                dispatch(updateSlackSuccess(webhook.data));
                return webhook.data;
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(updateSlackError(error));
            }
        );
    };
}

// Implements pagination for Webhooks Members table

export function paginateNext() {
    return {
        type: types.PAGINATE_NEXT,
    };
}

export function paginatePrev() {
    return {
        type: types.PAGINATE_PREV,
    };
}

export function paginateReset() {
    return {
        type: types.PAGINATE_RESET,
    };
}

export function paginate(type) {
    return function(dispatch) {
        type === 'next' && dispatch(paginateNext());
        type === 'prev' && dispatch(paginatePrev());
        type === 'reset' && dispatch(paginateReset());
    };
}
