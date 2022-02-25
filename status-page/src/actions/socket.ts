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

export function addincidentnotebysocket(note) {
    return function(dispatch) {
        dispatch({
            type: 'ADD_INCIDENT_NOTE',
            payload: note,
        });
    };
}

export function updateincidentnotebysocket(note) {
    return function(dispatch) {
        dispatch({
            type: 'UPDATE_INCIDENT_NOTE',
            payload: note,
        });
    };
}

export function addscheduledeventbysocket(event) {
    return function(dispatch) {
        dispatch({
            type: 'ADD_SCHEDULED_EVENT',
            payload: event,
        });
    };
}

export function deletescheduledeventbysocket(event) {
    return function(dispatch) {
        dispatch({
            type: 'DELETE_SCHEDULED_EVENT',
            payload: event,
        });
    };
}

export function updatescheduledeventbysocket(event) {
    return function(dispatch) {
        dispatch({
            type: 'UPDATE_SCHEDULED_EVENT',
            payload: event,
        });
    };
}

export function addeventnotebysocket(note) {
    return function(dispatch) {
        dispatch({
            type: 'ADD_EVENT_NOTE',
            payload: note,
        });
    };
}

export function deleteeventnotebysocket(note) {
    return function(dispatch) {
        dispatch({
            type: 'DELETE_EVENT_NOTE',
            payload: note,
        });
    };
}

export function updateeventnotebysocket(note) {
    return function(dispatch) {
        dispatch({
            type: 'UPDATE_EVENT_NOTE',
            payload: note,
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

export function incidentcreatedbysocket(incident) {
    return function(dispatch) {
        dispatch({
            type: 'INCIDENT_CREATED',
            payload: incident,
        });
    };
}

export function deleteincidentbysocket(incident) {
    return function(dispatch) {
        dispatch({
            type: 'INCIDENT_DELETED',
            payload: incident,
        });
    };
}

export function updateincidentbysocket(incident) {
    return function(dispatch) {
        dispatch({
            type: 'INCIDENT_UPDATED',
            payload: incident,
        });
    };
}

export function addincidenttimelinebysocket(timeline) {
    return function(dispatch) {
        dispatch({
            type: 'INCIDENT_TIMELINE_CREATED',
            payload: timeline,
        });
    };
}

export function deleteincidentnotebysocket(note) {
    return function(dispatch) {
        dispatch({
            type: 'DELETE_INCIDENT_NOTE',
            payload: note,
        });
    };
}

export function resolvescheduledeventbysocket(event) {
    return function(dispatch) {
        dispatch({
            type: 'RESOLVE_SCHEDULED_EVENT',
            payload: event,
        });
    };
}
export function updatestweetsbysocket(tweets) {
    return function(dispatch) {
        dispatch({
            type: 'UPDATE_TWEETS',
            payload: tweets,
        });
    };
}
