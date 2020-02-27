export function updatestatuspagebysocket(statuspage) {
    return function(dispatch) {
        dispatch({
            type: 'UPDATE_STATUS_PAGE',
            payload: statuspage,
        });
    };
}

export function updatemonitorbysocket(monitor) {
    return function(dispatch) {
        dispatch({
            type: 'UPDATE_MONITOR',
            payload: monitor,
        });
    };
}

export function deletemonitorbysocket(monitor) {
    return function(dispatch) {
        dispatch({
            type: 'DELETE_MONITOR',
            payload: monitor._id,
        });
    };
}

export function updatemonitorstatusbysocket(status, probes) {
    return function(dispatch) {
        dispatch({
            type: 'UPDATE_MONITOR_STATUS',
            payload: { status, probes },
        });
    };
}

export function updateincidentnotebysocket(incident) {
    return function(dispatch) {
        dispatch({
            type: 'UPDATE_INCIDENT_NOTE',
            payload: incident,
        });
    };
}

export function updateprobebysocket(probe) {
    return function(dispatch) {
        dispatch({
            type: 'UPDATE_PROBE',
            payload: probe,
        });
    };
}
