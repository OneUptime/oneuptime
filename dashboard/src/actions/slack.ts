import { deleteApi, getApi } from '../api';
import * as types from '../constants/slack';
import errors from '../errors';

// UNLINK a new SLACK LINK

export function deleteSlackLinkRequest() {
    return {
        type: types.DELETE_SLACK_LINK_REQUEST,
    };
}

export function deleteSlackLinkError(error: $TSFixMe) {
    return {
        type: types.DELETE_SLACK_LINK_FAILED,
        payload: error,
    };
}

export function deleteSlackLinkSuccess(deletedTeam: $TSFixMe) {
    return {
        type: types.DELETE_SLACK_LINK_SUCCESS,
        payload: deletedTeam,
    };
}

export const resetdeleteSlackLink = () => {
    return {
        type: types.DELETE_SLACK_LINK_RESET,
    };
};

// Calls the API to link slack team to project
export function deleteSlackLink(projectId: $TSFixMe, teamId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = deleteApi(`slack/${projectId}/unLink/${teamId}`, null);

        dispatch(deleteSlackLinkRequest());

        return promise.then(
            function(teams) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(deleteSlackLinkSuccess(teams.data));
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                return teams.data;
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
                dispatch(deleteSlackLinkError(errors(error)));
            }
        );
    };
}

export function getSlackTeamsRequest(promise: $TSFixMe) {
    return {
        type: types.GET_SLACK_TEAM_REQUEST,
        payload: promise,
    };
}

export function getSlackTeamsError(error: $TSFixMe) {
    return {
        type: types.GET_SLACK_TEAM_FAILED,
        payload: error,
    };
}

export function getSlackTeamsSuccess(teams: $TSFixMe) {
    return {
        type: types.GET_SLACK_TEAM_SUCCESS,
        payload: teams,
    };
}

export const resetGetSlackTeams = () => {
    return {
        type: types.GET_SLACK_TEAM_RESET,
    };
};

export function getSlackTeams(projectId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        let promise = null;
        if (skip && limit)
            promise = getApi(
                `slack/${projectId}/teams?skip=${skip}&limit=${limit}`
            );
        else {
            promise = getApi(`slack/${projectId}/teams`);
        }
        dispatch(getSlackTeamsRequest(promise));

        promise.then(
            function(teams) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(getSlackTeamsSuccess(teams.data));
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
                dispatch(getSlackTeamsError(errors(error)));
            }
        );

        return promise;
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
