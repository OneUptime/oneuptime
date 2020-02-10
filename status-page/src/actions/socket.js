
export function updatestatuspagebysocket(statuspage) {
  return function (dispatch) {
    dispatch({
      type: 'UPDATE_STATUS_PAGE',
      payload: statuspage
    });
  };
}

export function updatemonitorbysocket(monitor) {
  return function (dispatch) {
    dispatch({
      type: 'UPDATE_MONITOR',
      payload: monitor
    });
    dispatch({
      type: 'UPDATE_INCIDENT_MONITOR_NAME',
      payload: monitor
    });
  };
}

export function updatemonitorstatusbysocket(status, probes) {
  return function (dispatch) {
    dispatch({
      type: 'UPDATE_MONITOR_STATUS',
      payload: { status, probes }
    });
  };
}

export function incidentcreatedbysocket(incident) {
  return function (dispatch) {
    dispatch({
      type: 'ADD_NEW_INCIDENT',
      payload: incident
    });
  };
}

export function updateincidentnotesbysocket(incident) {
  return function (dispatch) {
    dispatch({
      type: 'UPDATE_INCIDENT_NOTES',
      payload: incident
    });
  };
}

export function incidentresolvedbysocket(incident) {
  return function (dispatch) {
    dispatch({
      type: 'INCIDENT_RESOLVED_BY_SOCKET',
      payload: incident
    });
  };
}

export function updateprobebysocket(probe) {
  return function (dispatch) {
    dispatch({
      type: 'UPDATE_PROBE',
      payload: probe
    });
  };
}