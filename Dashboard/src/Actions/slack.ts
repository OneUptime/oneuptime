import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/slack';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
// UNLINK a new SLACK LINK

export const deleteSlackLinkRequest = (): void => {
    return {
        type: types.DELETE_SLACK_LINK_REQUEST,
    };
};

export const deleteSlackLinkError = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_SLACK_LINK_FAILED,
        payload: error,
    };
};

export const deleteSlackLinkSuccess = (deletedTeam: $TSFixMe): void => {
    return {
        type: types.DELETE_SLACK_LINK_SUCCESS,
        payload: deletedTeam,
    };
};

export const resetdeleteSlackLink = (): void => {
    return {
        type: types.DELETE_SLACK_LINK_RESET,
    };
};

// Calls the API to link slack team to project
export const deleteSlackLink = (projectId: string, teamId: $TSFixMe): void => {
    return function (dispatch: Dispatch) {
        const promise = delete (`slack/${projectId}/unLink/${teamId}`, null);

        dispatch(deleteSlackLinkRequest());

        return promise.then(
            function (teams) {
                dispatch(deleteSlackLinkSuccess(teams.data));

                return teams.data;
            },
            function (error) {
                dispatch(deleteSlackLinkError(error));
            }
        );
    };
};

export const getSlackTeamsRequest = (promise: $TSFixMe): void => {
    return {
        type: types.GET_SLACK_TEAM_REQUEST,
        payload: promise,
    };
};

export const getSlackTeamsError = (error: ErrorPayload): void => {
    return {
        type: types.GET_SLACK_TEAM_FAILED,
        payload: error,
    };
};

export const getSlackTeamsSuccess = (teams: $TSFixMe): void => {
    return {
        type: types.GET_SLACK_TEAM_SUCCESS,
        payload: teams,
    };
};

export const resetGetSlackTeams = (): void => {
    return {
        type: types.GET_SLACK_TEAM_RESET,
    };
};

export function getSlackTeams(
    projectId: string,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch) {
        let promise = null;
        if (skip && limit)
            promise = BackendAPI.get(
                `slack/${projectId}/teams?skip=${skip}&limit=${limit}`
            );
        else {
            promise = BackendAPI.get(`slack/${projectId}/teams`);
        }
        dispatch(getSlackTeamsRequest(promise));

        promise.then(
            function (teams) {
                dispatch(getSlackTeamsSuccess(teams.data));
            },
            function (error) {
                dispatch(getSlackTeamsError(error));
            }
        );

        return promise;
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
    return function (dispatch: Dispatch) {
        type === 'next' && dispatch(paginateNext());
        type === 'prev' && dispatch(paginatePrev());
        type === 'reset' && dispatch(paginateReset());
    };
};
