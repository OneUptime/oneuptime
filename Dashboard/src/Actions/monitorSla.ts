import * as types from '../constants/monitorSla';
import BackendAPI from 'Common-ui/src/utils/api/backend';
import { Dispatch } from 'redux';
import ErrorPayload from 'Common-ui/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';

export const createMonitorSlaRequest = () => ({
    type: types.CREATE_MONITOR_SLA_REQUEST,
});

export const createMonitorSlaSuccess = (payload: $TSFixMe) => ({
    type: types.CREATE_MONITOR_SLA_SUCCESS,
    payload,
});

export const createMonitorSlaFailure = (error: ErrorPayload) => ({
    type: types.CREATE_MONITOR_SLA_FAILURE,
    payload: error,
});

export const createMonitorSla =
    (projectId: string, data: $TSFixMe) => async (dispatch: Dispatch) => {
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

export const updateMonitorSlaRequest = () => ({
    type: types.UPDATE_MONITOR_SLA_REQUEST,
});

export const updateMonitorSlaSuccess = (payload: $TSFixMe) => ({
    type: types.UPDATE_MONITOR_SLA_SUCCESS,
    payload,
});

export const updateMonitorSlaFailure = (error: ErrorPayload) => ({
    type: types.UPDATE_MONITOR_SLA_FAILURE,
    payload: error,
});

export const updateMonitorSla =
    (
        projectId: string,
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

export const fetchMonitorSlasRequest = () => ({
    type: types.FETCH_MONITOR_SLAS_REQUEST,
});

export const fetchMonitorSlasSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_MONITOR_SLAS_SUCCESS,
    payload,
});

export const fetchMonitorSlasFailure = (error: ErrorPayload) => ({
    type: types.FETCH_MONITOR_SLAS_FAILURE,
    payload: error,
});

export const fetchMonitorSlas =
    (projectId: string, skip: PositiveNumber, limit: PositiveNumber) =>
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

export const deleteMonitorSlaRequest = () => ({
    type: types.DELETE_MONITOR_SLA_REQUEST,
});

export const deleteMonitorSlaSuccess = (payload: $TSFixMe) => ({
    type: types.DELETE_MONITOR_SLA_SUCCESS,
    payload,
});

export const deleteMonitorSlaFailure = (error: ErrorPayload) => ({
    type: types.DELETE_MONITOR_SLA_FAILURE,
    payload: error,
});

export const deleteMonitorSla =
    (projectId: string, monitorSlaId: $TSFixMe) =>
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
export const setActiveMonitorSla = (monitorSlaId: $TSFixMe) => ({
    type: types.SET_ACTIVE_MONITOR_SLA,
    payload: monitorSlaId,
});

export const fetchDefaultMonitorSlaRequest = () => ({
    type: types.FETCH_DEFAULT_MONITOR_SLA_REQUEST,
});

export const fetchDefaultMonitorSlaSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_DEFAULT_MONITOR_SLA_SUCCESS,
    payload,
});

export const fetchDefaultMonitorSlaFailure = (error: ErrorPayload) => ({
    type: types.FETCH_DEFAULT_MONITOR_SLA_FAILURE,
    payload: error,
});

export const fetchDefaultMonitorSla =
    (projectId: string) => async (dispatch: Dispatch) => {
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
export const paginateNext = () => {
    return {
        type: types.NEXT_MONITOR_SLA_PAGE,
    };
};
export const paginatePrev = () => {
    return {
        type: types.PREV_MONITOR_SLA_PAGE,
    };
};
