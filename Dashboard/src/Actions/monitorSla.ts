import * as types from '../constants/monitorSla';
import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';

export const createMonitorSlaRequest = (): void => ({
    type: types.CREATE_MONITOR_SLA_REQUEST,
});

export const createMonitorSlaSuccess = (payload: $TSFixMe): void => ({
    type: types.CREATE_MONITOR_SLA_SUCCESS,
    payload,
});

export const createMonitorSlaFailure = (error: ErrorPayload): void => ({
    type: types.CREATE_MONITOR_SLA_FAILURE,
    payload: error,
});

export const createMonitorSla =
    (projectId: ObjectID, data: $TSFixMe) => async (dispatch: Dispatch) => {
        try {
            dispatch(createMonitorSlaRequest());

            const response = await BackendAPI.post(
                `monitorSla/${projectId}`,
                data
            );

            dispatch(createMonitorSlaSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(createMonitorSlaFailure(errorMsg));
        }
    };

export const updateMonitorSlaRequest = (): void => ({
    type: types.UPDATE_MONITOR_SLA_REQUEST,
});

export const updateMonitorSlaSuccess = (payload: $TSFixMe): void => ({
    type: types.UPDATE_MONITOR_SLA_SUCCESS,
    payload,
});

export const updateMonitorSlaFailure = (error: ErrorPayload): void => ({
    type: types.UPDATE_MONITOR_SLA_FAILURE,
    payload: error,
});

export const updateMonitorSla =
    (
        projectId: ObjectID,
        monitorSlaId: $TSFixMe,
        data: $TSFixMe,
        handleDefault = false
    ) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(updateMonitorSlaRequest());

            data.handleDefault = handleDefault;
            const response = await BackendAPI.put(
                `monitorSla/${projectId}/${monitorSlaId}`,
                data
            );

            dispatch(updateMonitorSlaSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(updateMonitorSlaFailure(errorMsg));
        }
    };

export const fetchMonitorSlasRequest = (): void => ({
    type: types.FETCH_MONITOR_SLAS_REQUEST,
});

export const fetchMonitorSlasSuccess = (payload: $TSFixMe): void => ({
    type: types.FETCH_MONITOR_SLAS_SUCCESS,
    payload,
});

export const fetchMonitorSlasFailure = (error: ErrorPayload): void => ({
    type: types.FETCH_MONITOR_SLAS_FAILURE,
    payload: error,
});

export const fetchMonitorSlas =
    (projectId: ObjectID, skip: PositiveNumber, limit: PositiveNumber) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(fetchMonitorSlasRequest());

            const response = await BackendAPI.get(
                `monitorSla/${projectId}?skip=${skip}&limit=${limit}`
            );

            dispatch(fetchMonitorSlasSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(fetchMonitorSlasFailure(errorMsg));
        }
    };

export const deleteMonitorSlaRequest = (): void => ({
    type: types.DELETE_MONITOR_SLA_REQUEST,
});

export const deleteMonitorSlaSuccess = (payload: $TSFixMe): void => ({
    type: types.DELETE_MONITOR_SLA_SUCCESS,
    payload,
});

export const deleteMonitorSlaFailure = (error: ErrorPayload): void => ({
    type: types.DELETE_MONITOR_SLA_FAILURE,
    payload: error,
});

export const deleteMonitorSla =
    (projectId: ObjectID, monitorSlaId: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(deleteMonitorSlaRequest());

            const response =
                await delete `monitorSla/${projectId}/${monitorSlaId}`;

            dispatch(deleteMonitorSlaSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(deleteMonitorSlaFailure(errorMsg));
        }
    };

// set active monitor sla
export const setActiveMonitorSla = (monitorSlaId: $TSFixMe): void => ({
    type: types.SET_ACTIVE_MONITOR_SLA,
    payload: monitorSlaId,
});

export const fetchDefaultMonitorSlaRequest = (): void => ({
    type: types.FETCH_DEFAULT_MONITOR_SLA_REQUEST,
});

export const fetchDefaultMonitorSlaSuccess = (payload: $TSFixMe): void => ({
    type: types.FETCH_DEFAULT_MONITOR_SLA_SUCCESS,
    payload,
});

export const fetchDefaultMonitorSlaFailure = (error: ErrorPayload): void => ({
    type: types.FETCH_DEFAULT_MONITOR_SLA_FAILURE,
    payload: error,
});

export const fetchDefaultMonitorSla =
    (projectId: ObjectID) => async (dispatch: Dispatch) => {
        try {
            dispatch(fetchDefaultMonitorSlaRequest());

            const response = await BackendAPI.get(
                `monitorSla/${projectId}/defaultMonitorSla`
            );

            dispatch(fetchDefaultMonitorSlaSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(fetchDefaultMonitorSlaFailure(errorMsg));
        }
    };
export const paginateNext = (): void => {
    return {
        type: types.NEXT_MONITOR_SLA_PAGE,
    };
};
export const paginatePrev = (): void => {
    return {
        type: types.PREV_MONITOR_SLA_PAGE,
    };
};
