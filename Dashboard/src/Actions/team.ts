import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/team';
import ErrorPayload from 'CommonUI/src/payload-types/error';
export const teamLoadingRequest = (): void => {
    return {
        type: types.TEAM_LOADING_REQUEST,
    };
};

export const teamLoadingSuccess = (team: $TSFixMe): void => {
    return {
        type: types.TEAM_LOADING_SUCCESS,
        payload: team,
    };
};

export const teamLoadingError = (error: ErrorPayload): void => {
    return {
        type: types.TEAM_LOADING_FAILURE,
        payload: error,
    };
};

// Calls the API to load team.
export const teamLoading = (projectId: ObjectID): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(`team/${projectId}`);
        dispatch(teamLoadingRequest());
        promise.then(
            (response): void => {
                const team = response.data;
                dispatch(teamLoadingSuccess(team));
            },
            (error): void => {
                dispatch(teamLoadingError(error));
            }
        );

        return promise;
    };
};

export const subProjectTeamLoadingRequest = (): void => {
    return {
        type: types.TEAM_SUBPROJECT_LOADING_REQUEST,
    };
};

export const subProjectTeamLoadingSuccess = (team: $TSFixMe): void => {
    return {
        type: types.TEAM_SUBPROJECT_LOADING_SUCCESS,
        payload: team,
    };
};

export const subProjectTeamLoadingError = (error: ErrorPayload): void => {
    return {
        type: types.TEAM_SUBPROJECT_LOADING_FAILURE,
        payload: error,
    };
};
// Calls the API to load team.
export const subProjectTeamLoading = (projectId: ObjectID): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(`team/${projectId}/teamMembers`);
        dispatch(subProjectTeamLoadingRequest());
        promise.then(
            (response): void => {
                const team = response.data;
                dispatch(subProjectTeamLoadingSuccess(team));
            },
            (error): void => {
                dispatch(subProjectTeamLoadingError(error));
            }
        );

        return promise;
    };
};

// Team create
export const teamCreateRequest = (): void => {
    return {
        type: types.TEAM_CREATE_REQUEST,
    };
};

export const teamCreateSuccess = (team: $TSFixMe): void => {
    return {
        type: types.TEAM_CREATE_SUCCESS,
        payload: team,
    };
};

export const teamCreateError = (error: ErrorPayload): void => {
    return {
        type: types.TEAM_CREATE_FAILURE,
        payload: error,
    };
};

// Calls the API to create team members.
export const teamCreate = (projectId: ObjectID, values: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(`team/${projectId}`, values);
        dispatch(teamCreateRequest());

        promise.then(
            (response): void => {
                const team = response.data;
                dispatch(teamCreateSuccess(team));
            },
            (error): void => {
                dispatch(teamCreateError(error));
            }
        );

        return promise;
    };
};

export const teamDeleteRequest = (id: $TSFixMe): void => {
    return {
        type: types.TEAM_DELETE_REQUEST,
        payload: id,
    };
};

export const teamDeleteSuccess = (team: $TSFixMe): void => {
    return {
        type: types.TEAM_DELETE_SUCCESS,
        payload: team,
    };
};

export const teamDeleteError = (error: ErrorPayload): void => {
    return {
        type: types.TEAM_DELETE_FAILURE,
        payload: error,
    };
};

export const teamDeleteReset = (): void => {
    return {
        type: types.TEAM_DELETE_RESET,
    };
};

export const resetTeamDelete = (): void => {
    return function (dispatch: Dispatch): void {
        dispatch(teamDeleteReset());
    };
};

// Calls the API to delete team meber.
export const teamDelete = (
    projectId: ObjectID,
    teamMemberId: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = delete (`team/${projectId}/${teamMemberId}`, null);
        dispatch(teamDeleteRequest(teamMemberId));

        promise.then(
            (response): void => {
                const team = response.data;
                dispatch(teamDeleteSuccess(team));
                return { team };
            },
            (error): void => {
                dispatch(teamDeleteError(error));
                return { error };
            }
        );

        return promise;
    };
};

export const teamMemberRequest = (teamMemberId: $TSFixMe): void => {
    return {
        type: types.TEAM_MEMBER_REQUEST,
        payload: teamMemberId,
    };
};

export const teamMemberSuccess = (teamMember: $TSFixMe): void => {
    return {
        type: types.TEAM_MEMBER_SUCCESS,
        payload: teamMember,
    };
};

export const teamMemberError = (error: ErrorPayload): void => {
    return {
        type: types.TEAM_MEMBER_FAILURE,
        payload: error,
    };
};

// Calls the API to get team member.
export const getTeamMember = (
    projectId: ObjectID,
    teamMemberId: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(`team/${projectId}/${teamMemberId}`);
        dispatch(teamMemberRequest(teamMemberId));

        promise.then(
            (response): void => {
                dispatch(teamMemberSuccess(response.data));
            },
            (error): void => {
                dispatch(teamMemberError(error));
            }
        );

        return promise;
    };
};

export const teamUpdateRoleRequest = (id: $TSFixMe): void => {
    return {
        type: types.TEAM_UPDATE_ROLE_REQUEST,
        payload: id,
    };
};

export const teamUpdateRoleSuccess = (team: $TSFixMe): void => {
    return {
        type: types.TEAM_UPDATE_ROLE_SUCCESS,
        payload: team,
    };
};

export const teamUpdateRoleError = (error: ErrorPayload): void => {
    return {
        type: types.TEAM_UPDATE_ROLE_FAILURE,
        payload: error,
    };
};

// Calls the API to update team member role.
export const teamUpdateRole = (projectId: ObjectID, values: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put(
            `team/${projectId}/${values.teamMemberId}/changerole`,
            values
        );
        dispatch(teamUpdateRoleRequest(values.teamMemberId));

        promise.then(
            (response): void => {
                const team = response.data;
                dispatch(teamUpdateRoleSuccess(team));
            },
            (error): void => {
                dispatch(teamUpdateRoleError(error));
            }
        );

        return promise;
    };
};

// Implements pagination for Team Members table
export const paginateNext = (Id: $TSFixMe): void => {
    return {
        type: types.PAGINATE_NEXT,
        payload: Id,
    };
};

export const paginatePrev = (Id: $TSFixMe): void => {
    return {
        type: types.PAGINATE_PREV,
        payload: Id,
    };
};

export const paginateReset = (): void => {
    return {
        type: types.PAGINATE_RESET,
    };
};

export const paginate = (type: $TSFixMe, Id: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        type === 'next' && dispatch(paginateNext(Id));
        type === 'prev' && dispatch(paginatePrev(Id));
        type === 'reset' && dispatch(paginateReset());
    };
};
