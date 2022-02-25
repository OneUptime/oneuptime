import { deleteApi, getApi } from '../api';
import * as types from '../constants/slack';
import errors from '../errors';

// UNLINK a new SLACK LINK

export function deleteSlackLinkRequest() {
    return {
        type: types.DELETE_SLACK_LINK_REQUEST,
    };
}

export function deleteSlackLinkError(error) {
    return {
        type: types.DELETE_SLACK_LINK_FAILED,
        payload: error,
    };
}

export function deleteSlackLinkSuccess(deletedTeam) {
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
export function deleteSlackLink(projectId, teamId) {
    return function(dispatch) {
        const promise = deleteApi(`slack/${projectId}/unLink/${teamId}`, null);

        dispatch(deleteSlackLinkRequest());

        return promise.then(
            function(teams) {
                dispatch(deleteSlackLinkSuccess(teams.data));
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

export function getSlackTeamsRequest(promise) {
    return {
        type: types.GET_SLACK_TEAM_REQUEST,
        payload: promise,
    };
}

export function getSlackTeamsError(error) {
    return {
        type: types.GET_SLACK_TEAM_FAILED,
        payload: error,
    };
}

export function getSlackTeamsSuccess(teams) {
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

export function getSlackTeams(projectId, skip, limit) {
    return function(dispatch) {
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

export function paginate(type) {
    return function(dispatch) {
        type === 'next' && dispatch(paginateNext());
        type === 'prev' && dispatch(paginatePrev());
        type === 'reset' && dispatch(paginateReset());
    };
}
