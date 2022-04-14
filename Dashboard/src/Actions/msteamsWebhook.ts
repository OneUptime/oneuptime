import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/msteams';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
export const deleteMsTeamsRequest: Function = (): void => {
    return {
        type: types.DELETE_MS_TEAMS_REQUEST,
    };
};

export const deleteMsTeamsError: Function = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_MS_TEAMS_FAILED,
        payload: error,
    };
};

export const deleteMsTeamsSuccess: Function = (
    deleteMsTeams: $TSFixMe
): void => {
    return {
        type: types.DELETE_MS_TEAMS_SUCCESS,
        payload: deleteMsTeams,
    };
};

export const resetDeleteMsTeams: Function = (): void => {
    return {
        type: types.DELETE_MS_TEAMS_RESET,
    };
};

// Calls the API to link webhook team to project
export const deleteMsTeams: Function = (
    projectId: ObjectID,
    msTeamsId: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe =
            delete (`webhook/${projectId}/delete/${msTeamsId}`, null);

        dispatch(deleteMsTeamsRequest());

        return promise.then(
            (msTeams): void => {
                dispatch(deleteMsTeamsSuccess(msTeams.data));

                return msTeams.data;
            },
            (error): void => {
                dispatch(deleteMsTeamsError(error));
            }
        );
    };
};

export const getMsTeamsRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.GET_MS_TEAMS_REQUEST,
        payload: promise,
    };
};

export const getMsTeamsError: Function = (error: ErrorPayload): void => {
    return {
        type: types.GET_MS_TEAMS_FAILED,
        payload: error,
    };
};

export const getMsTeamsSuccess: Function = (msTeams: $TSFixMe): void => {
    return {
        type: types.GET_MS_TEAMS_SUCCESS,
        payload: msTeams,
    };
};

export const resetGetMsTeams: Function = (): void => {
    return {
        type: types.GET_MS_TEAMS_RESET,
    };
};

export function getMsTeams(
    projectId: ObjectID,
    skip: PositiveNumber,
    limit: PositiveNumber
): void {
    return function (dispatch: Dispatch): void {
        let promise: $TSFixMe = null;
        promise = BackendAPI.get(
            `webhook/${projectId}/hooks?skip=${skip || 0}&limit=${
                limit || 10
            }&type=msteams`
        );
        dispatch(getMsTeamsRequest(promise));

        promise.then(
            (webhooks): void => {
                dispatch(getMsTeamsSuccess(webhooks.data));
            },
            (error): void => {
                dispatch(getMsTeamsError(error));
            }
        );

        return promise;
    };
}

export function getMsTeamsMonitor(
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
            }&type=msteams`
        );
        dispatch(getMsTeamsRequest(promise));

        promise.then(
            (webhooks): void => {
                dispatch(getMsTeamsSuccess(webhooks.data));
            },
            (error): void => {
                dispatch(getMsTeamsError(error));
            }
        );

        return promise;
    };
}

export const createMsTeamsRequest: Function = (): void => {
    return {
        type: types.CREATE_MS_TEAMS_REQUEST,
    };
};

export const createMsTeamsError: Function = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_MS_TEAMS_FAILED,
        payload: error,
    };
};

export const createMsTeamsSuccess: Function = (newWebHook: $TSFixMe): void => {
    return {
        type: types.CREATE_MS_TEAMS_SUCCESS,
        payload: newWebHook,
    };
};

export const resetCreateMsTeams: Function = (): void => {
    return {
        type: types.CREATE_MS_TEAMS_RESET,
    };
};

// Calls the API to add webhook to project
export const createMsTeams: Function = (
    projectId: ObjectID,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `webhook/${projectId}/create`,
            data
        );

        dispatch(createMsTeamsRequest());
        return promise.then(
            (webhook): void => {
                dispatch(createMsTeamsSuccess(webhook.data));

                return webhook.data;
            },
            (error): void => {
                dispatch(createMsTeamsError(error));
            }
        );
    };
};

export const updateMsTeamsRequest: Function = (): void => {
    return {
        type: types.UPDATE_MS_TEAMS_REQUEST,
    };
};

export const updateMsTeamsError: Function = (error: ErrorPayload): void => {
    return {
        type: types.UPDATE_MS_TEAMS_FAILED,
        payload: error,
    };
};

export const updateMsTeamsSuccess: Function = (newWebHook: $TSFixMe): void => {
    return {
        type: types.UPDATE_MS_TEAMS_SUCCESS,
        payload: newWebHook,
    };
};

export const resetUpdateMsTeams: Function = (): void => {
    return {
        type: types.UPDATE_MS_TEAMS_RESET,
    };
};

// Calls the API to add webhook to project
export function updateMsTeams(
    projectId: ObjectID,
    webhookId: $TSFixMe,
    data: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `webhook/${projectId}/${webhookId}`,
            data
        );

        dispatch(updateMsTeamsRequest());

        return promise.then(
            (webhook): void => {
                dispatch(updateMsTeamsSuccess(webhook.data));

                return webhook.data;
            },
            (error): void => {
                dispatch(updateMsTeamsError(error));
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
