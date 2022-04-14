import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/webHook';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
export const deleteWebHookRequest: Function = (): void => {
    return {
        type: types.DELETE_WEB_HOOK_REQUEST,
    };
};

export const deleteWebHookError: Function = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_WEB_HOOK_FAILED,
        payload: error,
    };
};

export const deleteWebHookSuccess: Function = (
    deleteWebHook: $TSFixMe
): void => {
    return {
        type: types.DELETE_WEB_HOOK_SUCCESS,
        payload: deleteWebHook,
    };
};

export const resetDeleteWebHook: Function = (): void => {
    return {
        type: types.DELETE_WEB_HOOK_RESET,
    };
};

// Calls the API to link webhook team to project
export const deleteWebHook: Function = (
    projectId: ObjectID,
    webhookId: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe =
            delete (`webhook/${projectId}/delete/${webhookId}`, null);

        dispatch(deleteWebHookRequest());

        return promise.then(
            (webhook): void => {
                dispatch(deleteWebHookSuccess(webhook.data));

                return webhook.data;
            },
            (error): void => {
                dispatch(deleteWebHookError(error));
            }
        );
    };
};

export const getWebHookRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.GET_WEB_HOOK_REQUEST,
        payload: promise,
    };
};

export const getWebHookError: Function = (error: ErrorPayload): void => {
    return {
        type: types.GET_WEB_HOOK_FAILED,
        payload: error,
    };
};

export const getWebHookSuccess: Function = (webhooks: $TSFixMe): void => {
    return {
        type: types.GET_WEB_HOOK_SUCCESS,
        payload: webhooks,
    };
};

export const resetGetWebHook: Function = (): void => {
    return {
        type: types.GET_WEB_HOOK_RESET,
    };
};

export function getWebHook(
    projectId: ObjectID,
    skip: PositiveNumber,
    limit: PositiveNumber
): void {
    return function (dispatch: Dispatch): void {
        let promise: $TSFixMe = null;
        promise = BackendAPI.get(
            `webhook/${projectId}/hooks?skip=${skip || 0}&limit=${limit || 10}`
        );
        dispatch(getWebHookRequest(promise));

        promise.then(
            (webhooks): void => {
                dispatch(getWebHookSuccess(webhooks.data));
            },
            (error): void => {
                dispatch(getWebHookError(error));
            }
        );

        return promise;
    };
}

export function getWebHookMonitor(
    projectId: ObjectID,
    monitorId: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch): void {
        let promise: $TSFixMe = null;
        promise = BackendAPI.get(
            `webhook/${projectId}/hooks/${monitorId}?skip=${skip || 0}&limit=${
                limit || 10
            }`
        );
        dispatch(getWebHookRequest(promise));

        promise.then(
            (webhooks): void => {
                dispatch(getWebHookSuccess(webhooks.data));
            },
            (error): void => {
                dispatch(getWebHookError(error));
            }
        );

        return promise;
    };
}

export const createWebHookRequest: Function = (): void => {
    return {
        type: types.CREATE_WEB_HOOK_REQUEST,
    };
};

export const createWebHookError: Function = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_WEB_HOOK_FAILED,
        payload: error,
    };
};

export const createWebHookSuccess: Function = (newWebHook: $TSFixMe): void => {
    return {
        type: types.CREATE_WEB_HOOK_SUCCESS,
        payload: newWebHook,
    };
};

export const resetCreateWebHook: Function = (): void => {
    return {
        type: types.CREATE_WEB_HOOK_RESET,
    };
};

// Calls the API to add webhook to project
export const createWebHook: Function = (
    projectId: ObjectID,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `webhook/${projectId}/create`,
            data
        );

        dispatch(createWebHookRequest());

        return promise.then(
            (webhook): void => {
                dispatch(createWebHookSuccess(webhook.data));

                return webhook.data;
            },
            (error): void => {
                dispatch(createWebHookError(error));
            }
        );
    };
};

export const updateWebHookRequest: Function = (): void => {
    return {
        type: types.UPDATE_WEB_HOOK_REQUEST,
    };
};

export const updateWebHookError: Function = (error: ErrorPayload): void => {
    return {
        type: types.UPDATE_WEB_HOOK_FAILED,
        payload: error,
    };
};

export const updateWebHookSuccess: Function = (newWebHook: $TSFixMe): void => {
    return {
        type: types.UPDATE_WEB_HOOK_SUCCESS,
        payload: newWebHook,
    };
};

export const resetUpdateWebHook: Function = (): void => {
    return {
        type: types.UPDATE_WEB_HOOK_RESET,
    };
};

// Calls the API to add webhook to project
export function updateWebHook(
    projectId: ObjectID,
    webhookId: $TSFixMe,
    data: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `webhook/${projectId}/${webhookId}`,
            data
        );

        dispatch(updateWebHookRequest());

        return promise.then(
            (webhook): void => {
                dispatch(updateWebHookSuccess(webhook.data));

                return webhook.data;
            },
            (error): void => {
                dispatch(updateWebHookError(error));
            }
        );
    };
}

// Implements pagination for Webhooks Members table

export const paginateNext: Function = (): void => {
    return {
        type: types.PAGINATE_NEXT,
    };
};

export const paginatePrev: Function = (): void => {
    return {
        type: types.PAGINATE_PREV,
    };
};

export const paginateReset: Function = (): void => {
    return {
        type: types.PAGINATE_RESET,
    };
};

export const paginate: Function = (type: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        type === 'next' && dispatch(paginateNext());
        type === 'prev' && dispatch(paginatePrev());
        type === 'reset' && dispatch(paginateReset());
    };
};
