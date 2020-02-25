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

export const getIncidentsRequest = promise => {
  return {
    type: types.GET_INCIDENTS_REQUEST,
    payload: promise
  }
}

export const getIncidentsSuccess = reports => {
  return {
    type: types.GET_INCIDENTS_SUCCESS,
    payload: reports
  }
}

export const getIncidentsError = error => {
  return {
    type: types.GET_INCIDENTS_FAILED,
    payload: error
  }
}

export const getIncidents = (projectId, filter, startDate, endDate) => async dispatch => {
  try {
    const promise = getApi(`reports/${projectId}/incidents?startDate=${startDate}&endDate=${endDate}&filter=${filter}`);
    dispatch(getIncidentsRequest(promise));
    const reports = await promise;
    dispatch(getIncidentsSuccess(reports.data));
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
    dispatch(getIncidentsError(newerror));
  }
}

export const getResolveTimeRequest = promise => {
  return {
    type: types.GET_RESOLVE_TIME_REQUEST,
    payload: promise
  }
}

export const getResolveTimeSuccess = reports => {
  return {
    type: types.GET_RESOLVE_TIME_SUCCESS,
    payload: reports
  }
}

export const getResolveTimeError = error => {
  return {
    type: types.GET_RESOLVE_TIME_FAILED,
    payload: error
  }
}

export const getResolveTime = (projectId, filter, startDate, endDate) => async dispatch => {
  try {
    const promise = getApi(`reports/${projectId}/average-resolved?startDate=${startDate}&endDate=${endDate}&filter=${filter}`);
    dispatch(getResolveTimeRequest(promise));
    const reports = await promise;
    dispatch(getResolveTimeSuccess(reports.data));
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
    dispatch(getResolveTimeError(newerror));
  }
}
