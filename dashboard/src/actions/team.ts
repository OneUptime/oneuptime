import BackendAPI from 'common-ui/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/team';
import ErrorPayload from 'common-ui/src/payload-types/error';
export const teamLoadingRequest = () => {
    return {
        type: types.TEAM_LOADING_REQUEST,
    };
};

export const teamLoadingSuccess = (team: $TSFixMe) => {
    return {
        type: types.TEAM_LOADING_SUCCESS,
        payload: team,
    };
};

export const teamLoadingError = (error: ErrorPayload) => {
    return {
        type: types.TEAM_LOADING_FAILURE,
        payload: error,
    };
};

// Calls the API to load team.
export const teamLoading = (projectId: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(`team/${projectId}`);
        dispatch(teamLoadingRequest());
        promise.then(
            function (response) {
                const team = response.data;
                dispatch(teamLoadingSuccess(team));
            },
            function (error) {
                dispatch(teamLoadingError(error));
            }
        );

        return promise;
    };
};

export const subProjectTeamLoadingRequest = () => {
    return {
        type: types.TEAM_SUBPROJECT_LOADING_REQUEST,
    };
};

export const subProjectTeamLoadingSuccess = (team: $TSFixMe) => {
    return {
        type: types.TEAM_SUBPROJECT_LOADING_SUCCESS,
        payload: team,
    };
};

export const subProjectTeamLoadingError = (error: ErrorPayload) => {
    return {
        type: types.TEAM_SUBPROJECT_LOADING_FAILURE,
        payload: error,
    };
};
// Calls the API to load team.
export const subProjectTeamLoading = (projectId: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(`team/${projectId}/teamMembers`);
        dispatch(subProjectTeamLoadingRequest());
        promise.then(
            function (response) {
                const team = response.data;
                dispatch(subProjectTeamLoadingSuccess(team));
            },
            function (error) {
                dispatch(subProjectTeamLoadingError(error));
            }
        );

        return promise;
    };
};

// Team create
export const teamCreateRequest = () => {
    return {
        type: types.TEAM_CREATE_REQUEST,
    };
};

export const teamCreateSuccess = (team: $TSFixMe) => {
    return {
        type: types.TEAM_CREATE_SUCCESS,
        payload: team,
    };
};

export const teamCreateError = (error: ErrorPayload) => {
    return {
        type: types.TEAM_CREATE_FAILURE,
        payload: error,
    };
};

// Calls the API to create team members.
export const teamCreate = (projectId: $TSFixMe, values: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(`team/${projectId}`, values);
        dispatch(teamCreateRequest());

        promise.then(
            function (response) {
                const team = response.data;
                dispatch(teamCreateSuccess(team));
            },
            function (error) {
                dispatch(teamCreateError(error));
            }
        );

        return promise;
    };
};

export const teamDeleteRequest = (id: $TSFixMe) => {
    return {
        type: types.TEAM_DELETE_REQUEST,
        payload: id,
    };
};

export const teamDeleteSuccess = (team: $TSFixMe) => {
    return {
        type: types.TEAM_DELETE_SUCCESS,
        payload: team,
    };
};

export const teamDeleteError = (error: ErrorPayload) => {
    return {
        type: types.TEAM_DELETE_FAILURE,
        payload: error,
    };
};

export const teamDeleteReset = () => {
    return {
        type: types.TEAM_DELETE_RESET,
    };
};

export const resetTeamDelete = () => {
    return function (dispatch: Dispatch) {
        dispatch(teamDeleteReset());
    };
};

// Calls the API to delete team meber.
export const teamDelete = (projectId: $TSFixMe, teamMemberId: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = delete (`team/${projectId}/${teamMemberId}`, null);
        dispatch(teamDeleteRequest(teamMemberId));

        promise.then(
            function (response) {
                const team = response.data;
                dispatch(teamDeleteSuccess(team));
                return { team };
            },
            function (error) {
                dispatch(teamDeleteError(error));
                return { error };
            }
        );

        return promise;
    };
};

export const teamMemberRequest = (teamMemberId: $TSFixMe) => {
    return {
        type: types.TEAM_MEMBER_REQUEST,
        payload: teamMemberId,
    };
};

export const teamMemberSuccess = (teamMember: $TSFixMe) => {
    return {
        type: types.TEAM_MEMBER_SUCCESS,
        payload: teamMember,
    };
};

export const teamMemberError = (error: ErrorPayload) => {
    return {
        type: types.TEAM_MEMBER_FAILURE,
        payload: error,
    };
};

// Calls the API to get team member.
export const getTeamMember = (projectId: $TSFixMe, teamMemberId: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(`team/${projectId}/${teamMemberId}`);
        dispatch(teamMemberRequest(teamMemberId));

        promise.then(
            function (response) {
                dispatch(teamMemberSuccess(response.data));
            },
            function (error) {
                dispatch(teamMemberError(error));
            }
        );

        return promise;
    };
};

export const teamUpdateRoleRequest = (id: $TSFixMe) => {
    return {
        type: types.TEAM_UPDATE_ROLE_REQUEST,
        payload: id,
    };
};

export const teamUpdateRoleSuccess = (team: $TSFixMe) => {
    return {
        type: types.TEAM_UPDATE_ROLE_SUCCESS,
        payload: team,
    };
};

export const teamUpdateRoleError = (error: ErrorPayload) => {
    return {
        type: types.TEAM_UPDATE_ROLE_FAILURE,
        payload: error,
    };
};

// Calls the API to update team member role.
export const teamUpdateRole = (projectId: $TSFixMe, values: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(
            `team/${projectId}/${values.teamMemberId}/changerole`,
            values
        );
        dispatch(teamUpdateRoleRequest(values.teamMemberId));

        promise.then(
            function (response) {
                const team = response.data;
                dispatch(teamUpdateRoleSuccess(team));
            },
            function (error) {
                dispatch(teamUpdateRoleError(error));
            }
        );

        return promise;
    };
};

// Implements pagination for Team Members table
export const paginateNext = (Id: $TSFixMe) => {
    return {
        type: types.PAGINATE_NEXT,
        payload: Id,
    };
};

export const paginatePrev = (Id: $TSFixMe) => {
    return {
        type: types.PAGINATE_PREV,
        payload: Id,
    };
};

export const paginateReset = () => {
    return {
        type: types.PAGINATE_RESET,
    };
};

export const paginate = (type: $TSFixMe, Id: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        type === 'next' && dispatch(paginateNext(Id));
        type === 'prev' && dispatch(paginatePrev(Id));
        type === 'reset' && dispatch(paginateReset());
    };
};
