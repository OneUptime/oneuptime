import { getApi } from '../api';
import * as types from '../constants/report';


// Incident Reports Section

export const getActiveMembersRequest = promise => {
  return {
    type: types.GET_ACTIVE_MEMBERS_REQUEST,
    payload: promise
  };
}

export const getActiveMembersSuccess = members => {
  return {
    type: types.GET_ACTIVE_MEMBERS_SUCCESS,
    payload: members
  };
}

export const getActiveMembersError = error => {
  return {
    type: types.GET_ACTIVE_MEMBERS_FAILED,
    payload: error
  };
}

export const getActiveMembers = (projectId, startDate, endDate, skip, limit) => async dispatch => {
  try {
    const promise = getApi(`reports/${projectId}/active-members?startDate=${startDate}&endDate=${endDate}&skip=${skip}&limit=${limit}`);
    dispatch(getActiveMembersRequest(promise));
    const members = await promise;
    dispatch(getActiveMembersSuccess(members.data));
  }
  catch (error) {
    let newerror = error;
    if (newerror && newerror.response && newerror.response.data)
      newerror = newerror.response.data;
    if (newerror && newerror.data) {
      newerror = newerror.data;
    }
    if (newerror && newerror.message) {
      newerror = newerror.message;
    }
    else {
      newerror = 'Network Error';
    }
    dispatch(getActiveMembersError(newerror));
  }
}

export const getActiveMonitorsRequest = promise => {
  return {
    type: types.GET_ACTIVE_MONITORS_REQUEST,
    payload: promise
  };
}

export const getActiveMonitorsSuccess = monitors => {
  return {
    type: types.GET_ACTIVE_MONITORS_SUCCESS,
    payload: monitors
  };
}

export const getActiveMonitorsError = error => {
  return {
    type: types.GET_ACTIVE_MONITORS_FAILED,
    payload: error
  };
}

export const getActiveMonitors = (projectId, startDate, endDate, skip, limit) => async dispatch => {
  try {
    const promise = getApi(`reports/${projectId}/active-monitors?startDate=${startDate}&endDate=${endDate}&skip=${skip || 0}&limit=${limit || 0}`);
    dispatch(getActiveMonitorsRequest(promise));
    const monitors = await promise;
    dispatch(getActiveMonitorsSuccess(monitors.data));
  }
  catch (error) {
    let newerror = error;
    if (newerror && newerror.response && newerror.response.data)
      newerror = newerror.response.data;
    if (newerror && newerror.data) {
      newerror = newerror.data;
    }
    if (newerror && newerror.message) {
      newerror = newerror.message;
    }
    else {
      newerror = 'Network Error';
    }
    dispatch(getActiveMonitorsError(newerror));
  }
}

export const getMonthlyIncidentsRequest = promise => {
  return {
    type: types.GET_MONTHLY_INCIDENTS_REQUEST,
    payload: promise
  };
}

export const getMonthlyIncidentsSuccess = months => {
  return {
    type: types.GET_MONTHLY_INCIDENTS_SUCCESS,
    payload: months
  };
}

export const getMonthlyIncidentsError = error => {
  return {
    type: types.GET_MONTHLY_INCIDENTS_FAILED,
    payload: error
  };
}

export const getMonthlyIncidents = (projectId) => async dispatch => {
  try {
    const promise = getApi(`reports/${projectId}/monthly-incidents`);
    dispatch(getMonthlyIncidentsRequest(promise));
    const months = await promise;
    dispatch(getMonthlyIncidentsSuccess(months.data));
  }
  catch (error) {
    let newerror = error;
    if (newerror && newerror.response && newerror.response.data)
      newerror = newerror.response.data;
    if (newerror && newerror.data) {
      newerror = newerror.data;
    }
    if (newerror && newerror.message) {
      newerror = newerror.message;
    }
    else {
      newerror = 'Network Error';
    }
    dispatch(getMonthlyIncidentsError(newerror));
  }
}

export const getMonthlyResolveTimeRequest = promise => {
  return {
    type: types.GET_MONTHLY_RESOLVE_TIME_REQUEST,
    payload: promise
  };
}

export const getMonthlyResolveTimeSuccess = months => {
  return {
    type: types.GET_MONTHLY_RESOLVE_TIME_SUCCESS,
    payload: months
  };
}

export const getMonthlyResolveTimeError = error => {
  return {
    type: types.GET_MONTHLY_RESOLVE_TIME_FAILED,
    payload: error
  };
}

export const getMonthlyResolveTime = (projectId) => async dispatch => {
  try {
    const promise = getApi(`reports/${projectId}/average-resolved`);
    dispatch(getMonthlyResolveTimeRequest(promise));
    const months = await promise;
    dispatch(getMonthlyResolveTimeSuccess(months.data));
  }
  catch (error) {
    let newerror = error;
    if (newerror && newerror.response && newerror.response.data)
      newerror = newerror.response.data;
    if (newerror && newerror.data) {
      newerror = newerror.data;
    }
    if (newerror && newerror.message) {
      newerror = newerror.message;
    }
    else {
      newerror = 'Network Error';
    }
    dispatch(getMonthlyResolveTimeError(newerror));
  }
}
