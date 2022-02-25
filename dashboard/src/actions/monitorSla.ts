import * as types from '../constants/monitorSla';
import { postApi, getApi, deleteApi, putApi } from '../api';

export const createMonitorSlaRequest = () => ({
    type: types.CREATE_MONITOR_SLA_REQUEST,
});

export const createMonitorSlaSuccess = payload => ({
    type: types.CREATE_MONITOR_SLA_SUCCESS,
    payload,
});

export const createMonitorSlaFailure = error => ({
    type: types.CREATE_MONITOR_SLA_FAILURE,
    payload: error,
});

export const createMonitorSla = (projectId, data) => async dispatch => {
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

export const updateMonitorSlaSuccess = payload => ({
    type: types.UPDATE_MONITOR_SLA_SUCCESS,
    payload,
});

export const updateMonitorSlaFailure = error => ({
    type: types.UPDATE_MONITOR_SLA_FAILURE,
    payload: error,
});

export const updateMonitorSla = (
    projectId,
    monitorSlaId,
    data,
    handleDefault = false
) => async dispatch => {
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

export const fetchMonitorSlasSuccess = payload => ({
    type: types.FETCH_MONITOR_SLAS_SUCCESS,
    payload,
});

export const fetchMonitorSlasFailure = error => ({
    type: types.FETCH_MONITOR_SLAS_FAILURE,
    payload: error,
});

export const fetchMonitorSlas = (projectId, skip, limit) => async dispatch => {
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

export const deleteMonitorSlaSuccess = payload => ({
    type: types.DELETE_MONITOR_SLA_SUCCESS,
    payload,
});

export const deleteMonitorSlaFailure = error => ({
    type: types.DELETE_MONITOR_SLA_FAILURE,
    payload: error,
});

export const deleteMonitorSla = (projectId, monitorSlaId) => async dispatch => {
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
export const setActiveMonitorSla = monitorSlaId => ({
    type: types.SET_ACTIVE_MONITOR_SLA,
    payload: monitorSlaId,
});

export const fetchDefaultMonitorSlaRequest = () => ({
    type: types.FETCH_DEFAULT_MONITOR_SLA_REQUEST,
});

export const fetchDefaultMonitorSlaSuccess = payload => ({
    type: types.FETCH_DEFAULT_MONITOR_SLA_SUCCESS,
    payload,
});

export const fetchDefaultMonitorSlaFailure = error => ({
    type: types.FETCH_DEFAULT_MONITOR_SLA_FAILURE,
    payload: error,
});

export const fetchDefaultMonitorSla = projectId => async dispatch => {
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
