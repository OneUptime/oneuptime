import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/report';
import ErrorPayload from 'CommonUI/src/PayloadTypes/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
// Incident Reports Section

export const getActiveMembersRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.GET_ACTIVE_MEMBERS_REQUEST,
        payload: promise,
    };
};

export const getActiveMembersSuccess: Function = (members: $TSFixMe): void => {
    return {
        type: types.GET_ACTIVE_MEMBERS_SUCCESS,
        payload: members,
    };
};

export const getActiveMembersError: Function = (error: ErrorPayload): void => {
    return {
        type: types.GET_ACTIVE_MEMBERS_FAILED,
        payload: error,
    };
};

export const getActiveMembers: $TSFixMe = (
    projectId: ObjectID,
    startDate: $TSFixMe,
    endDate: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) => {
    return async (dispatch: Dispatch) => {
        try {
            const promise: $TSFixMe = BackendAPI.get(
                `reports/${projectId}/active-members?startDate=${startDate}&endDate=${endDate}&skip=${skip}&limit=${limit}`
            );
            dispatch(getActiveMembersRequest(promise));
            const members: $TSFixMe = await promise;

            dispatch(getActiveMembersSuccess(members.data));
        } catch (error) {
            let newerror: $TSFixMe = error;
            if (newerror && newerror.response && newerror.response.data) {
                newerror = newerror.response.data;
            }
            if (newerror && newerror.data) {
                newerror = newerror.data;
            }
            if (newerror && newerror.message) {
                newerror = newerror.message;
            } else {
                newerror = 'Network Error';
            }
            dispatch(getActiveMembersError(newerror));
        }
    };
};

export const getActiveMonitorsRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.GET_ACTIVE_MONITORS_REQUEST,
        payload: promise,
    };
};

export const getActiveMonitorsSuccess: Function = (
    monitors: $TSFixMe
): void => {
    return {
        type: types.GET_ACTIVE_MONITORS_SUCCESS,
        payload: monitors,
    };
};

export const getActiveMonitorsError: Function = (error: ErrorPayload): void => {
    return {
        type: types.GET_ACTIVE_MONITORS_FAILED,
        payload: error,
    };
};

export const getActiveMonitors: $TSFixMe = (
    projectId: ObjectID,
    startDate: $TSFixMe,
    endDate: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) => {
    return async (dispatch: Dispatch) => {
        try {
            const promise: $TSFixMe = BackendAPI.get(
                `reports/${projectId}/active-monitors?startDate=${startDate}&endDate=${endDate}&skip=${
                    skip || 0
                }&limit=${limit || 0}`
            );
            dispatch(getActiveMonitorsRequest(promise));
            const monitors: $TSFixMe = await promise;

            dispatch(getActiveMonitorsSuccess(monitors.data));
        } catch (error) {
            let newerror: $TSFixMe = error;
            if (newerror && newerror.response && newerror.response.data) {
                newerror = newerror.response.data;
            }
            if (newerror && newerror.data) {
                newerror = newerror.data;
            }
            if (newerror && newerror.message) {
                newerror = newerror.message;
            } else {
                newerror = 'Network Error';
            }
            dispatch(getActiveMonitorsError(newerror));
        }
    };
};

export const getIncidentsRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.GET_INCIDENTS_REQUEST,
        payload: promise,
    };
};

export const getIncidentsSuccess: Function = (reports: $TSFixMe): void => {
    return {
        type: types.GET_INCIDENTS_SUCCESS,
        payload: reports,
    };
};

export const getIncidentsError: Function = (error: ErrorPayload): void => {
    return {
        type: types.GET_INCIDENTS_FAILED,
        payload: error,
    };
};

export const getIncidents: $TSFixMe = (
    projectId: ObjectID,
    filter: $TSFixMe,
    startDate: $TSFixMe,
    endDate: $TSFixMe
) => {
    return async (dispatch: Dispatch) => {
        try {
            const promise: $TSFixMe = BackendAPI.get(
                `reports/${projectId}/incidents?startDate=${startDate}&endDate=${endDate}&filter=${filter}`
            );
            dispatch(getIncidentsRequest(promise));
            const reports: $TSFixMe = await promise;

            dispatch(getIncidentsSuccess(reports.data));
        } catch (error) {
            let newerror: $TSFixMe = error;
            if (newerror && newerror.response && newerror.response.data) {
                newerror = newerror.response.data;
            }
            if (newerror && newerror.data) {
                newerror = newerror.data;
            }
            if (newerror && newerror.message) {
                newerror = newerror.message;
            } else {
                newerror = 'Network Error';
            }
            dispatch(getIncidentsError(newerror));
        }
    };
};

export const getResolveTimeRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.GET_RESOLVE_TIME_REQUEST,
        payload: promise,
    };
};

export const getResolveTimeSuccess: Function = (reports: $TSFixMe): void => {
    return {
        type: types.GET_RESOLVE_TIME_SUCCESS,
        payload: reports,
    };
};

export const getResolveTimeError: Function = (error: ErrorPayload): void => {
    return {
        type: types.GET_RESOLVE_TIME_FAILED,
        payload: error,
    };
};

export const getResolveTime: $TSFixMe = (
    projectId: ObjectID,
    filter: $TSFixMe,
    startDate: $TSFixMe,
    endDate: $TSFixMe
) => {
    return async (dispatch: Dispatch) => {
        try {
            const promise: $TSFixMe = BackendAPI.get(
                `reports/${projectId}/average-resolved?startDate=${startDate}&endDate=${endDate}&filter=${filter}`
            );
            dispatch(getResolveTimeRequest(promise));
            const reports: $TSFixMe = await promise;

            dispatch(getResolveTimeSuccess(reports.data));
        } catch (error) {
            let newerror: $TSFixMe = error;
            if (newerror && newerror.response && newerror.response.data) {
                newerror = newerror.response.data;
            }
            if (newerror && newerror.data) {
                newerror = newerror.data;
            }
            if (newerror && newerror.message) {
                newerror = newerror.message;
            } else {
                newerror = 'Network Error';
            }
            dispatch(getResolveTimeError(newerror));
        }
    };
};
