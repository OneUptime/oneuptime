import BackendAPI from 'common-ui/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/slackWebhooks';
import ErrorPayload from 'common-ui/src/payload-types/error';
export const deleteSlackRequest = () => {
    return {
        type: types.DELETE_SLACK_WEBHOOK_REQUEST,
    };
};

export const deleteSlackError = (error: ErrorPayload) => {
    return {
        type: types.DELETE_SLACK_WEBHOOK_FAILED,
        payload: error,
    };
};

export const deleteSlackSuccess = (deleteSlack: $TSFixMe) => {
    return {
        type: types.DELETE_SLACK_WEBHOOK_SUCCESS,
        payload: deleteSlack,
    };
};

export const resetDeleteSlack = () => {
    return {
        type: types.DELETE_SLACK_WEBHOOK_RESET,
    };
};

// Calls the API to link webhook team to project
export const deleteSlack = (projectId: $TSFixMe, msTeamsId: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = delete (`webhook/${projectId}/delete/${msTeamsId}`,
        null);

        dispatch(deleteSlackRequest());

        return promise.then(
            function (msTeams) {
                dispatch(deleteSlackSuccess(msTeams.data));

                return msTeams.data;
            },
            function (error) {
                dispatch(deleteSlackError(error));
            }
        );
    };
};

export const getSlackRequest = (promise: $TSFixMe) => {
    return {
        type: types.GET_SLACK_WEBHOOK_REQUEST,
        payload: promise,
    };
};

export const getSlackError = (error: ErrorPayload) => {
    return {
        type: types.GET_SLACK_WEBHOOK_FAILED,
        payload: error,
    };
};

export const getSlackSuccess = (msTeams: $TSFixMe) => {
    return {
        type: types.GET_SLACK_WEBHOOK_SUCCESS,
        payload: msTeams,
    };
};

export const resetGetSlack = () => {
    return {
        type: types.GET_SLACK_WEBHOOK_RESET,
    };
};

export const getSlack = (
    projectId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) => {
    return function (dispatch: Dispatch) {
        let promise = null;
        promise = BackendAPI.get(
            `webhook/${projectId}/hooks?skip=${skip || 0}&limit=${
                limit || 10
            }&type=slack`
        );
        dispatch(getSlackRequest(promise));

        promise.then(
            function (webhooks) {
                dispatch(getSlackSuccess(webhooks.data));
            },
            function (error) {
                dispatch(getSlackError(error));
            }
        );

        return promise;
    };
};

export function getSlackMonitor(
    projectId: $TSFixMe,
    monitorId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        let promise = null;
        promise = BackendAPI.get(
            `webhook/${projectId}/hooks/${monitorId}?skip=${skip || 0}&limit=${
                limit || 10
            }&type=slack`
        );
        dispatch(getSlackRequest(promise));

        promise.then(
            function (webhooks) {
                dispatch(getSlackSuccess(webhooks.data));
            },
            function (error) {
                dispatch(getSlackError(error));
            }
        );

        return promise;
    };
}

export const createSlackRequest = () => {
    return {
        type: types.CREATE_SLACK_WEBHOOK_REQUEST,
    };
};

export const createSlackError = (error: ErrorPayload) => {
    return {
        type: types.CREATE_SLACK_WEBHOOK_FAILED,
        payload: error,
    };
};

export const createSlackSuccess = (newWebHook: $TSFixMe) => {
    return {
        type: types.CREATE_SLACK_WEBHOOK_SUCCESS,
        payload: newWebHook,
    };
};

export const resetCreateSlack = () => {
    return {
        type: types.CREATE_SLACK_WEBHOOK_RESET,
    };
};

// Calls the API to add webhook to project
export const createSlack = (projectId: $TSFixMe, data: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(`webhook/${projectId}/create`, data);

        dispatch(createSlackRequest());
        return promise.then(
            function (webhook) {
                dispatch(createSlackSuccess(webhook.data));

                return webhook.data;
            },
            function (error) {
                dispatch(createSlackError(error));
            }
        );
    };
};

export const updateSlackRequest = () => {
    return {
        type: types.UPDATE_SLACK_WEBHOOK_REQUEST,
    };
};

export const updateSlackError = (error: ErrorPayload) => {
    return {
        type: types.UPDATE_SLACK_WEBHOOK_FAILED,
        payload: error,
    };
};

export const updateSlackSuccess = (newWebHook: $TSFixMe) => {
    return {
        type: types.UPDATE_SLACK_WEBHOOK_SUCCESS,
        payload: newWebHook,
    };
};

export const resetUpdateSlack = () => {
    return {
        type: types.UPDATE_SLACK_WEBHOOK_RESET,
    };
};

// Calls the API to add webhook to project
export function updateSlack(
    projectId: $TSFixMe,
    webhookId: $TSFixMe,
    data: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(
            `webhook/${projectId}/${webhookId}`,
            data
        );

        dispatch(updateSlackRequest());

        return promise.then(
            function (webhook) {
                dispatch(updateSlackSuccess(webhook.data));

                return webhook.data;
            },
            function (error) {
                dispatch(updateSlackError(error));
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
