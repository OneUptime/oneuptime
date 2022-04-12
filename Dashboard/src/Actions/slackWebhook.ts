import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/slackWebhooks';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';

export const deleteSlackRequest = (): void => {
    return {
        type: types.DELETE_SLACK_WEBHOOK_REQUEST,
    };
};

export const deleteSlackError = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_SLACK_WEBHOOK_FAILED,
        payload: error,
    };
};

export const deleteSlackSuccess = (deleteSlack: $TSFixMe): void => {
    return {
        type: types.DELETE_SLACK_WEBHOOK_SUCCESS,
        payload: deleteSlack,
    };
};

export const resetDeleteSlack = (): void => {
    return {
        type: types.DELETE_SLACK_WEBHOOK_RESET,
    };
};

// Calls the API to link webhook team to project
export const deleteSlack = (projectId: string, msTeamsId: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise = delete (`webhook/${projectId}/delete/${msTeamsId}`,
        null);

        dispatch(deleteSlackRequest());

        return promise.then(
            function (msTeams): void {
                dispatch(deleteSlackSuccess(msTeams.data));

                return msTeams.data;
            },
            function (error): void {
                dispatch(deleteSlackError(error));
            }
        );
    };
};

export const getSlackRequest = (promise: $TSFixMe): void => {
    return {
        type: types.GET_SLACK_WEBHOOK_REQUEST,
        payload: promise,
    };
};

export const getSlackError = (error: ErrorPayload): void => {
    return {
        type: types.GET_SLACK_WEBHOOK_FAILED,
        payload: error,
    };
};

export const getSlackSuccess = (msTeams: $TSFixMe): void => {
    return {
        type: types.GET_SLACK_WEBHOOK_SUCCESS,
        payload: msTeams,
    };
};

export const resetGetSlack = (): void => {
    return {
        type: types.GET_SLACK_WEBHOOK_RESET,
    };
};

export const getSlack = (
    projectId: string,
    skip: PositiveNumber,
    limit: PositiveNumber
): void => {
    return function (dispatch: Dispatch): void {
        let promise = null;
        promise = BackendAPI.get(
            `webhook/${projectId}/hooks?skip=${skip || 0}&limit=${
                limit || 10
            }&type=slack`
        );
        dispatch(getSlackRequest(promise));

        promise.then(
            function (webhooks): void {
                dispatch(getSlackSuccess(webhooks.data));
            },
            function (error): void {
                dispatch(getSlackError(error));
            }
        );

        return promise;
    };
};

export function getSlackMonitor(
    projectId: string,
    monitorId: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch): void {
        let promise = null;
        promise = BackendAPI.get(
            `webhook/${projectId}/hooks/${monitorId}?skip=${skip || 0}&limit=${
                limit || 10
            }&type=slack`
        );
        dispatch(getSlackRequest(promise));

        promise.then(
            function (webhooks): void {
                dispatch(getSlackSuccess(webhooks.data));
            },
            function (error): void {
                dispatch(getSlackError(error));
            }
        );

        return promise;
    };
}

export const createSlackRequest = (): void => {
    return {
        type: types.CREATE_SLACK_WEBHOOK_REQUEST,
    };
};

export const createSlackError = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_SLACK_WEBHOOK_FAILED,
        payload: error,
    };
};

export const createSlackSuccess = (newWebHook: $TSFixMe): void => {
    return {
        type: types.CREATE_SLACK_WEBHOOK_SUCCESS,
        payload: newWebHook,
    };
};

export const resetCreateSlack = (): void => {
    return {
        type: types.CREATE_SLACK_WEBHOOK_RESET,
    };
};

// Calls the API to add webhook to project
export const createSlack = (projectId: string, data: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(`webhook/${projectId}/create`, data);

        dispatch(createSlackRequest());
        return promise.then(
            function (webhook): void {
                dispatch(createSlackSuccess(webhook.data));

                return webhook.data;
            },
            function (error): void {
                dispatch(createSlackError(error));
            }
        );
    };
};

export const updateSlackRequest = (): void => {
    return {
        type: types.UPDATE_SLACK_WEBHOOK_REQUEST,
    };
};

export const updateSlackError = (error: ErrorPayload): void => {
    return {
        type: types.UPDATE_SLACK_WEBHOOK_FAILED,
        payload: error,
    };
};

export const updateSlackSuccess = (newWebHook: $TSFixMe): void => {
    return {
        type: types.UPDATE_SLACK_WEBHOOK_SUCCESS,
        payload: newWebHook,
    };
};

export const resetUpdateSlack = (): void => {
    return {
        type: types.UPDATE_SLACK_WEBHOOK_RESET,
    };
};

// Calls the API to add webhook to project
export function updateSlack(
    projectId: string,
    webhookId: $TSFixMe,
    data: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put(
            `webhook/${projectId}/${webhookId}`,
            data
        );

        dispatch(updateSlackRequest());

        return promise.then(
            function (webhook): void {
                dispatch(updateSlackSuccess(webhook.data));

                return webhook.data;
            },
            function (error): void {
                dispatch(updateSlackError(error));
            }
        );
    };
}

// Implements pagination for Webhooks Members table

export const paginateNext = (): void => {
    return {
        type: types.PAGINATE_NEXT,
    };
};

export const paginatePrev = (): void => {
    return {
        type: types.PAGINATE_PREV,
    };
};

export const paginateReset = (): void => {
    return {
        type: types.PAGINATE_RESET,
    };
};

export const paginate = (type: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        type === 'next' && dispatch(paginateNext());
        type === 'prev' && dispatch(paginatePrev());
        type === 'reset' && dispatch(paginateReset());
    };
};
