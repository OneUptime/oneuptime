import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/slackWebhooks';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';

export const deleteSlackRequest: Function = (): void => {
    return {
        type: types.DELETE_SLACK_WEBHOOK_REQUEST,
    };
};

export const deleteSlackError: Function = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_SLACK_WEBHOOK_FAILED,
        payload: error,
    };
};

export const deleteSlackSuccess: Function = (deleteSlack: $TSFixMe): void => {
    return {
        type: types.DELETE_SLACK_WEBHOOK_SUCCESS,
        payload: deleteSlack,
    };
};

export const resetDeleteSlack: Function = (): void => {
    return {
        type: types.DELETE_SLACK_WEBHOOK_RESET,
    };
};

// Calls the API to link webhook team to project
export const deleteSlack: Function = (
    projectId: ObjectID,
    msTeamsId: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe =
            delete (`webhook/${projectId}/delete/${msTeamsId}`, null);

        dispatch(deleteSlackRequest());

        return promise.then(
            (msTeams): void => {
                dispatch(deleteSlackSuccess(msTeams.data));

                return msTeams.data;
            },
            (error): void => {
                dispatch(deleteSlackError(error));
            }
        );
    };
};

export const getSlackRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.GET_SLACK_WEBHOOK_REQUEST,
        payload: promise,
    };
};

export const getSlackError: Function = (error: ErrorPayload): void => {
    return {
        type: types.GET_SLACK_WEBHOOK_FAILED,
        payload: error,
    };
};

export const getSlackSuccess: Function = (msTeams: $TSFixMe): void => {
    return {
        type: types.GET_SLACK_WEBHOOK_SUCCESS,
        payload: msTeams,
    };
};

export const resetGetSlack: Function = (): void => {
    return {
        type: types.GET_SLACK_WEBHOOK_RESET,
    };
};

export const getSlack: Function = (
    projectId: ObjectID,
    skip: PositiveNumber,
    limit: PositiveNumber
): void => {
    return function (dispatch: Dispatch): void {
        let promise: $TSFixMe = null;
        promise = BackendAPI.get(
            `webhook/${projectId}/hooks?skip=${skip || 0}&limit=${
                limit || 10
            }&type=slack`
        );
        dispatch(getSlackRequest(promise));

        promise.then(
            (webhooks): void => {
                dispatch(getSlackSuccess(webhooks.data));
            },
            (error): void => {
                dispatch(getSlackError(error));
            }
        );

        return promise;
    };
};

export function getSlackMonitor(
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
            }&type=slack`
        );
        dispatch(getSlackRequest(promise));

        promise.then(
            (webhooks): void => {
                dispatch(getSlackSuccess(webhooks.data));
            },
            (error): void => {
                dispatch(getSlackError(error));
            }
        );

        return promise;
    };
}

export const createSlackRequest: Function = (): void => {
    return {
        type: types.CREATE_SLACK_WEBHOOK_REQUEST,
    };
};

export const createSlackError: Function = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_SLACK_WEBHOOK_FAILED,
        payload: error,
    };
};

export const createSlackSuccess: Function = (newWebHook: $TSFixMe): void => {
    return {
        type: types.CREATE_SLACK_WEBHOOK_SUCCESS,
        payload: newWebHook,
    };
};

export const resetCreateSlack: Function = (): void => {
    return {
        type: types.CREATE_SLACK_WEBHOOK_RESET,
    };
};

// Calls the API to add webhook to project
export const createSlack: Function = (
    projectId: ObjectID,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `webhook/${projectId}/create`,
            data
        );

        dispatch(createSlackRequest());
        return promise.then(
            (webhook): void => {
                dispatch(createSlackSuccess(webhook.data));

                return webhook.data;
            },
            (error): void => {
                dispatch(createSlackError(error));
            }
        );
    };
};

export const updateSlackRequest: Function = (): void => {
    return {
        type: types.UPDATE_SLACK_WEBHOOK_REQUEST,
    };
};

export const updateSlackError: Function = (error: ErrorPayload): void => {
    return {
        type: types.UPDATE_SLACK_WEBHOOK_FAILED,
        payload: error,
    };
};

export const updateSlackSuccess: Function = (newWebHook: $TSFixMe): void => {
    return {
        type: types.UPDATE_SLACK_WEBHOOK_SUCCESS,
        payload: newWebHook,
    };
};

export const resetUpdateSlack: Function = (): void => {
    return {
        type: types.UPDATE_SLACK_WEBHOOK_RESET,
    };
};

// Calls the API to add webhook to project
export function updateSlack(
    projectId: ObjectID,
    webhookId: $TSFixMe,
    data: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `webhook/${projectId}/${webhookId}`,
            data
        );

        dispatch(updateSlackRequest());

        return promise.then(
            (webhook): void => {
                dispatch(updateSlackSuccess(webhook.data));

                return webhook.data;
            },
            (error): void => {
                dispatch(updateSlackError(error));
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
