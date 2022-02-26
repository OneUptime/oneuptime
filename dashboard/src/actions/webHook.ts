import { deleteApi, getApi, postApi, putApi } from '../api';
import * as types from '../constants/webHook';

export function deleteWebHookRequest() {
    return {
        type: types.DELETE_WEB_HOOK_REQUEST,
    };
}

export function deleteWebHookError(error: $TSFixMe) {
    return {
        type: types.DELETE_WEB_HOOK_FAILED,
        payload: error,
    };
}

export function deleteWebHookSuccess(deleteWebHook: $TSFixMe) {
    return {
        type: types.DELETE_WEB_HOOK_SUCCESS,
        payload: deleteWebHook,
    };
}

export const resetDeleteWebHook = () => {
    return {
        type: types.DELETE_WEB_HOOK_RESET,
    };
};

// Calls the API to link webhook team to project
export function deleteWebHook(projectId: $TSFixMe, webhookId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = deleteApi(
            `webhook/${projectId}/delete/${webhookId}`,
            null
        );

        dispatch(deleteWebHookRequest());

        return promise.then(
            function(webhook) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(deleteWebHookSuccess(webhook.data));
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
                dispatch(deleteWebHookError(error));
            }
        );
    };
}

export function getWebHookRequest(promise: $TSFixMe) {
    return {
        type: types.GET_WEB_HOOK_REQUEST,
        payload: promise,
    };
}

export function getWebHookError(error: $TSFixMe) {
    return {
        type: types.GET_WEB_HOOK_FAILED,
        payload: error,
    };
}

export function getWebHookSuccess(webhooks: $TSFixMe) {
    return {
        type: types.GET_WEB_HOOK_SUCCESS,
        payload: webhooks,
    };
}

export const resetGetWebHook = () => {
    return {
        type: types.GET_WEB_HOOK_RESET,
    };
};

export function getWebHook(projectId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        let promise = null;
        promise = getApi(
            `webhook/${projectId}/hooks?skip=${skip || 0}&limit=${limit || 10}`
        );
        dispatch(getWebHookRequest(promise));

        promise.then(
            function(webhooks) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(getWebHookSuccess(webhooks.data));
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
                dispatch(getWebHookError(error));
            }
        );

        return promise;
    };
}

export function getWebHookMonitor(projectId: $TSFixMe, monitorId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        let promise = null;
        promise = getApi(
            `webhook/${projectId}/hooks/${monitorId}?skip=${skip ||
                0}&limit=${limit || 10}`
        );
        dispatch(getWebHookRequest(promise));

        promise.then(
            function(webhooks) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(getWebHookSuccess(webhooks.data));
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
                dispatch(getWebHookError(error));
            }
        );

        return promise;
    };
}

export function createWebHookRequest() {
    return {
        type: types.CREATE_WEB_HOOK_REQUEST,
    };
}

export function createWebHookError(error: $TSFixMe) {
    return {
        type: types.CREATE_WEB_HOOK_FAILED,
        payload: error,
    };
}

export function createWebHookSuccess(newWebHook: $TSFixMe) {
    return {
        type: types.CREATE_WEB_HOOK_SUCCESS,
        payload: newWebHook,
    };
}

export const resetCreateWebHook = () => {
    return {
        type: types.CREATE_WEB_HOOK_RESET,
    };
};

// Calls the API to add webhook to project
export function createWebHook(projectId: $TSFixMe, data: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = postApi(`webhook/${projectId}/create`, data);

        dispatch(createWebHookRequest());

        return promise.then(
            function(webhook) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(createWebHookSuccess(webhook.data));
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
                dispatch(createWebHookError(error));
            }
        );
    };
}

export function updateWebHookRequest() {
    return {
        type: types.UPDATE_WEB_HOOK_REQUEST,
    };
}

export function updateWebHookError(error: $TSFixMe) {
    return {
        type: types.UPDATE_WEB_HOOK_FAILED,
        payload: error,
    };
}

export function updateWebHookSuccess(newWebHook: $TSFixMe) {
    return {
        type: types.UPDATE_WEB_HOOK_SUCCESS,
        payload: newWebHook,
    };
}

export const resetUpdateWebHook = () => {
    return {
        type: types.UPDATE_WEB_HOOK_RESET,
    };
};

// Calls the API to add webhook to project
export function updateWebHook(projectId: $TSFixMe, webhookId: $TSFixMe, data: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = putApi(`webhook/${projectId}/${webhookId}`, data);

        dispatch(updateWebHookRequest());

        return promise.then(
            function(webhook) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(updateWebHookSuccess(webhook.data));
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
                dispatch(updateWebHookError(error));
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

export function paginate(type: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        type === 'next' && dispatch(paginateNext());
        type === 'prev' && dispatch(paginatePrev());
        type === 'reset' && dispatch(paginateReset());
    };
}
