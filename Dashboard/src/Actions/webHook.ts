import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/webHook';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
export const deleteWebHookRequest = () => {
    return {
        type: types.DELETE_WEB_HOOK_REQUEST,
    };
};

export const deleteWebHookError = (error: ErrorPayload) => {
    return {
        type: types.DELETE_WEB_HOOK_FAILED,
        payload: error,
    };
};

export const deleteWebHookSuccess = (deleteWebHook: $TSFixMe) => {
    return {
        type: types.DELETE_WEB_HOOK_SUCCESS,
        payload: deleteWebHook,
    };
};

export const resetDeleteWebHook = () => {
    return {
        type: types.DELETE_WEB_HOOK_RESET,
    };
};

// Calls the API to link webhook team to project
export const deleteWebHook = (projectId: string, webhookId: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = delete (`webhook/${projectId}/delete/${webhookId}`,
        null);

        dispatch(deleteWebHookRequest());

        return promise.then(
            function (webhook) {
                dispatch(deleteWebHookSuccess(webhook.data));

                return webhook.data;
            },
            function (error) {
                dispatch(deleteWebHookError(error));
            }
        );
    };
};

export const getWebHookRequest = (promise: $TSFixMe) => {
    return {
        type: types.GET_WEB_HOOK_REQUEST,
        payload: promise,
    };
};

export const getWebHookError = (error: ErrorPayload) => {
    return {
        type: types.GET_WEB_HOOK_FAILED,
        payload: error,
    };
};

export const getWebHookSuccess = (webhooks: $TSFixMe) => {
    return {
        type: types.GET_WEB_HOOK_SUCCESS,
        payload: webhooks,
    };
};

export const resetGetWebHook = () => {
    return {
        type: types.GET_WEB_HOOK_RESET,
    };
};

export function getWebHook(
    projectId: string,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch) {
        let promise = null;
        promise = BackendAPI.get(
            `webhook/${projectId}/hooks?skip=${skip || 0}&limit=${limit || 10}`
        );
        dispatch(getWebHookRequest(promise));

        promise.then(
            function (webhooks) {
                dispatch(getWebHookSuccess(webhooks.data));
            },
            function (error) {
                dispatch(getWebHookError(error));
            }
        );

        return promise;
    };
}

export function getWebHookMonitor(
    projectId: string,
    monitorId: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch) {
        let promise = null;
        promise = BackendAPI.get(
            `webhook/${projectId}/hooks/${monitorId}?skip=${skip || 0}&limit=${
                limit || 10
            }`
        );
        dispatch(getWebHookRequest(promise));

        promise.then(
            function (webhooks) {
                dispatch(getWebHookSuccess(webhooks.data));
            },
            function (error) {
                dispatch(getWebHookError(error));
            }
        );

        return promise;
    };
}

export const createWebHookRequest = () => {
    return {
        type: types.CREATE_WEB_HOOK_REQUEST,
    };
};

export const createWebHookError = (error: ErrorPayload) => {
    return {
        type: types.CREATE_WEB_HOOK_FAILED,
        payload: error,
    };
};

export const createWebHookSuccess = (newWebHook: $TSFixMe) => {
    return {
        type: types.CREATE_WEB_HOOK_SUCCESS,
        payload: newWebHook,
    };
};

export const resetCreateWebHook = () => {
    return {
        type: types.CREATE_WEB_HOOK_RESET,
    };
};

// Calls the API to add webhook to project
export const createWebHook = (projectId: string, data: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(`webhook/${projectId}/create`, data);

        dispatch(createWebHookRequest());

        return promise.then(
            function (webhook) {
                dispatch(createWebHookSuccess(webhook.data));

                return webhook.data;
            },
            function (error) {
                dispatch(createWebHookError(error));
            }
        );
    };
};

export const updateWebHookRequest = () => {
    return {
        type: types.UPDATE_WEB_HOOK_REQUEST,
    };
};

export const updateWebHookError = (error: ErrorPayload) => {
    return {
        type: types.UPDATE_WEB_HOOK_FAILED,
        payload: error,
    };
};

export const updateWebHookSuccess = (newWebHook: $TSFixMe) => {
    return {
        type: types.UPDATE_WEB_HOOK_SUCCESS,
        payload: newWebHook,
    };
};

export const resetUpdateWebHook = () => {
    return {
        type: types.UPDATE_WEB_HOOK_RESET,
    };
};

// Calls the API to add webhook to project
export function updateWebHook(
    projectId: string,
    webhookId: $TSFixMe,
    data: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(
            `webhook/${projectId}/${webhookId}`,
            data
        );

        dispatch(updateWebHookRequest());

        return promise.then(
            function (webhook) {
                dispatch(updateWebHookSuccess(webhook.data));

                return webhook.data;
            },
            function (error) {
                dispatch(updateWebHookError(error));
            }
        );
    };
}

// Implements pagination for Webhooks Members table

export const paginateNext = () => {
    return {
        type: types.PAGINATE_NEXT,
    };
};

export const paginatePrev = () => {
    return {
        type: types.PAGINATE_PREV,
    };
};

export const paginateReset = () => {
    return {
        type: types.PAGINATE_RESET,
    };
};

export const paginate = (type: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        type === 'next' && dispatch(paginateNext());
        type === 'prev' && dispatch(paginatePrev());
        type === 'reset' && dispatch(paginateReset());
    };
};
