import BackendAPI from '../api';
import { Dispatch } from 'redux';
import * as types from '../constants/msteams';

export const deleteMsTeamsRequest = () => {
    return {
        type: types.DELETE_MS_TEAMS_REQUEST,
    };
};

export const deleteMsTeamsError = (error: $TSFixMe) => {
    return {
        type: types.DELETE_MS_TEAMS_FAILED,
        payload: error,
    };
};

export const deleteMsTeamsSuccess = (deleteMsTeams: $TSFixMe) => {
    return {
        type: types.DELETE_MS_TEAMS_SUCCESS,
        payload: deleteMsTeams,
    };
};

export const resetDeleteMsTeams = () => {
    return {
        type: types.DELETE_MS_TEAMS_RESET,
    };
};

// Calls the API to link webhook team to project
export const deleteMsTeams = (projectId: $TSFixMe, msTeamsId: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = delete (`webhook/${projectId}/delete/${msTeamsId}`,
            null);

        dispatch(deleteMsTeamsRequest());

        return promise.then(
            function (msTeams) {
                dispatch(deleteMsTeamsSuccess(msTeams.data));

                return msTeams.data;
            },
            function (error) {

                dispatch(deleteMsTeamsError(error));
            }
        );
    };
};

export const getMsTeamsRequest = (promise: $TSFixMe) => {
    return {
        type: types.GET_MS_TEAMS_REQUEST,
        payload: promise,
    };
};

export const getMsTeamsError = (error: $TSFixMe) => {
    return {
        type: types.GET_MS_TEAMS_FAILED,
        payload: error,
    };
};

export const getMsTeamsSuccess = (msTeams: $TSFixMe) => {
    return {
        type: types.GET_MS_TEAMS_SUCCESS,
        payload: msTeams,
    };
};

export const resetGetMsTeams = () => {
    return {
        type: types.GET_MS_TEAMS_RESET,
    };
};

export function getMsTeams(
    projectId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        let promise = null;
        promise = BackendAPI.get(
            `webhook/${projectId}/hooks?skip=${skip || 0}&limit=${limit || 10
            }&type=msteams`
        );
        dispatch(getMsTeamsRequest(promise));

        promise.then(
            function (webhooks) {
                dispatch(getMsTeamsSuccess(webhooks.data));
            },
            function (error) {

                dispatch(getMsTeamsError(error));
            }
        );

        return promise;
    };
}

export function getMsTeamsMonitor(
    projectId: $TSFixMe,
    monitorId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        let promise = null;
        promise = BackendAPI.get(
            `webhook/${projectId}/hooks/${monitorId}?skip=${skip || 0}&limit=${limit || 10
            }&type=msteams`
        );
        dispatch(getMsTeamsRequest(promise));

        promise.then(
            function (webhooks) {
                dispatch(getMsTeamsSuccess(webhooks.data));
            },
            function (error) {

                dispatch(getMsTeamsError(error));
            }
        );

        return promise;
    };
}

export const createMsTeamsRequest = () => {
    return {
        type: types.CREATE_MS_TEAMS_REQUEST,
    };
};

export const createMsTeamsError = (error: $TSFixMe) => {
    return {
        type: types.CREATE_MS_TEAMS_FAILED,
        payload: error,
    };
};

export const createMsTeamsSuccess = (newWebHook: $TSFixMe) => {
    return {
        type: types.CREATE_MS_TEAMS_SUCCESS,
        payload: newWebHook,
    };
};

export const resetCreateMsTeams = () => {
    return {
        type: types.CREATE_MS_TEAMS_RESET,
    };
};

// Calls the API to add webhook to project
export const createMsTeams = (projectId: $TSFixMe, data: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(`webhook/${projectId}/create`, data);

        dispatch(createMsTeamsRequest());
        return promise.then(
            function (webhook) {
                dispatch(createMsTeamsSuccess(webhook.data));

                return webhook.data;
            },
            function (error) {

                dispatch(createMsTeamsError(error));
            }
        );
    };
};

export const updateMsTeamsRequest = () => {
    return {
        type: types.UPDATE_MS_TEAMS_REQUEST,
    };
};

export const updateMsTeamsError = (error: $TSFixMe) => {
    return {
        type: types.UPDATE_MS_TEAMS_FAILED,
        payload: error,
    };
};

export const updateMsTeamsSuccess = (newWebHook: $TSFixMe) => {
    return {
        type: types.UPDATE_MS_TEAMS_SUCCESS,
        payload: newWebHook,
    };
};

export const resetUpdateMsTeams = () => {
    return {
        type: types.UPDATE_MS_TEAMS_RESET,
    };
};

// Calls the API to add webhook to project
export function updateMsTeams(
    projectId: $TSFixMe,
    webhookId: $TSFixMe,
    data: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(
            `webhook/${projectId}/${webhookId}`,
            data
        );

        dispatch(updateMsTeamsRequest());

        return promise.then(
            function (webhook) {
                dispatch(updateMsTeamsSuccess(webhook.data));

                return webhook.data;
            },
            function (error) {

                dispatch(updateMsTeamsError(error));
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
