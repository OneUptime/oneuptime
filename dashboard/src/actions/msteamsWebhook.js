import { deleteApi, getApi, postApi, putApi } from '../api';
import * as types from '../constants/msteams';

export function deleteMsTeamsRequest() {
    return {
        type: types.DELETE_MS_TEAMS_REQUEST,
    };
}

export function deleteMsTeamsError(error) {
    return {
        type: types.DELETE_MS_TEAMS_FAILED,
        payload: error,
    };
}

export function deleteMsTeamsSuccess(deleteMsTeams) {
    return {
        type: types.DELETE_MS_TEAMS_SUCCESS,
        payload: deleteMsTeams,
    };
}

export const resetDeleteMsTeams = () => {
    return {
        type: types.DELETE_MS_TEAMS_RESET,
    };
};

// Calls the API to link webhook team to project
export function deleteMsTeams(projectId, msTeamsId) {
    return function(dispatch) {
        const promise = deleteApi(
            `webhook/${projectId}/delete/${msTeamsId}`,
            null
        );

        dispatch(deleteMsTeamsRequest());

        return promise.then(
            function(msTeams) {
                dispatch(deleteMsTeamsSuccess(msTeams.data));
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
                dispatch(deleteMsTeamsError(error));
            }
        );
    };
}

export function getMsTeamsRequest(promise) {
    return {
        type: types.GET_MS_TEAMS_REQUEST,
        payload: promise,
    };
}

export function getMsTeamsError(error) {
    return {
        type: types.GET_MS_TEAMS_FAILED,
        payload: error,
    };
}

export function getMsTeamsSuccess(msTeams) {
    return {
        type: types.GET_MS_TEAMS_SUCCESS,
        payload: msTeams,
    };
}

export const resetGetMsTeams = () => {
    return {
        type: types.GET_MS_TEAMS_RESET,
    };
};

export function getMsTeams(projectId, skip, limit) {
    return function(dispatch) {
        let promise = null;
        promise = getApi(
            `webhook/${projectId}/hooks?skip=${skip || 0}&limit=${limit ||
                10}&type=msteams`
        );
        dispatch(getMsTeamsRequest(promise));

        promise.then(
            function(webhooks) {
                dispatch(getMsTeamsSuccess(webhooks.data));
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
                dispatch(getMsTeamsError(error));
            }
        );

        return promise;
    };
}

export function createMsTeamsRequest() {
    return {
        type: types.CREATE_MS_TEAMS_REQUEST,
    };
}

export function createMsTeamsError(error) {
    return {
        type: types.CREATE_MS_TEAMS_FAILED,
        payload: error,
    };
}

export function createMsTeamsSuccess(newWebHook) {
    return {
        type: types.CREATE_MS_TEAMS_SUCCESS,
        payload: newWebHook,
    };
}

export const resetCreateMsTeams = () => {
    return {
        type: types.CREATE_MS_TEAMS_RESET,
    };
};

// Calls the API to add webhook to project
export function createMsTeams(projectId, data) {
    return function(dispatch) {
        const promise = postApi(`webhook/${projectId}/create`, data);

        dispatch(createMsTeamsRequest());

        return promise.then(
            function(webhook) {
                dispatch(createMsTeamsSuccess(webhook.data));
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
                dispatch(createMsTeamsError(error));
            }
        );
    };
}

export function updateMsTeamsRequest() {
    return {
        type: types.UPDATE_MS_TEAMS_REQUEST,
    };
}

export function updateMsTeamsError(error) {
    return {
        type: types.UPDATE_MS_TEAMS_FAILED,
        payload: error,
    };
}

export function updateMsTeamsSuccess(newWebHook) {
    return {
        type: types.UPDATE_MS_TEAMS_SUCCESS,
        payload: newWebHook,
    };
}

export const resetUpdateMsTeams = () => {
    return {
        type: types.UPDATE_MS_TEAMS_RESET,
    };
};

// Calls the API to add webhook to project
export function updateMsTeams(projectId, webhookId, data) {
    return function(dispatch) {
        const promise = putApi(`webhook/${projectId}/${webhookId}`, data);

        dispatch(updateMsTeamsRequest());

        return promise.then(
            function(webhook) {
                dispatch(updateMsTeamsSuccess(webhook.data));
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
                dispatch(updateMsTeamsError(error));
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
