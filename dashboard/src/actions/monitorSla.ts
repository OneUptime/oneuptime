import * as types from '../constants/monitorSla';
import { postApi, getApi, deleteApi, putApi } from '../api';
import { Dispatch } from 'redux';

export const createMonitorSlaRequest = () => ({
    type: types.CREATE_MONITOR_SLA_REQUEST,
});

export const createMonitorSlaSuccess = (payload: $TSFixMe) => ({
    type: types.CREATE_MONITOR_SLA_SUCCESS,
    payload,
});

export const createMonitorSlaFailure = (error: $TSFixMe) => ({
    type: types.CREATE_MONITOR_SLA_FAILURE,
    payload: error,
});

export const createMonitorSla =
    (projectId: $TSFixMe, data: $TSFixMe) => async (dispatch: Dispatch) => {
        try {
            dispatch(createMonitorSlaRequest());

            const response = await postApi(`monitorSla/${projectId}`, data);

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

export const updateMonitorSlaFailure = (error: $TSFixMe) => ({
    type: types.UPDATE_MONITOR_SLA_FAILURE,
    payload: error,
});

export const updateMonitorSla =
    (
        projectId: $TSFixMe,
        monitorSlaId: $TSFixMe,
        data: $TSFixMe,
        handleDefault = false
    ) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(updateMonitorSlaRequest());

            data.handleDefault = handleDefault;
            const response = await putApi(
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

export const fetchMonitorSlasFailure = (error: $TSFixMe) => ({
    type: types.FETCH_MONITOR_SLAS_FAILURE,
    payload: error,
});

export const fetchMonitorSlas =
    (projectId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(fetchMonitorSlasRequest());

            const response = await getApi(
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

export const deleteMonitorSlaFailure = (error: $TSFixMe) => ({
    type: types.DELETE_MONITOR_SLA_FAILURE,
    payload: error,
});

export const deleteMonitorSla =
    (projectId: $TSFixMe, monitorSlaId: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(deleteMonitorSlaRequest());

            const response = await deleteApi(
                `monitorSla/${projectId}/${monitorSlaId}`
            );

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

export const fetchDefaultMonitorSlaFailure = (error: $TSFixMe) => ({
    type: types.FETCH_DEFAULT_MONITOR_SLA_FAILURE,
    payload: error,
});

export const fetchDefaultMonitorSla =
    (projectId: $TSFixMe) => async (dispatch: Dispatch) => {
        try {
            dispatch(fetchDefaultMonitorSlaRequest());

            const response = await getApi(
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
