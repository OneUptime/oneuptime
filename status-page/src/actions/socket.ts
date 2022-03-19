export function updatestatuspagebysocket(statuspage: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'UPDATE_STATUS_PAGE',
            payload: statuspage,
        });
    };
}

export function updatemonitorbysocket(monitor: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'UPDATE_MONITOR',
            payload: monitor,
        });
    };
}

export function deletemonitorbysocket(monitor: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'DELETE_MONITOR',
            payload: monitor._id,
        });
    };
}

export function updatemonitorstatusbysocket(
    status: $TSFixMe,
    probes: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'UPDATE_MONITOR_STATUS',
            payload: { status, probes },
        });
    };
}

export function addincidentnotebysocket(note: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'ADD_INCIDENT_NOTE',
            payload: note,
        });
    };
}

export function updateincidentnotebysocket(note: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'UPDATE_INCIDENT_NOTE',
            payload: note,
        });
    };
}

export function addscheduledeventbysocket(event: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'ADD_SCHEDULED_EVENT',
            payload: event,
        });
    };
}

export function deletescheduledeventbysocket(event: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'DELETE_SCHEDULED_EVENT',
            payload: event,
        });
    };
}

export function updatescheduledeventbysocket(event: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'UPDATE_SCHEDULED_EVENT',
            payload: event,
        });
    };
}

export function addeventnotebysocket(note: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'ADD_EVENT_NOTE',
            payload: note,
        });
    };
}

export function deleteeventnotebysocket(note: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'DELETE_EVENT_NOTE',
            payload: note,
        });
    };
}

export function updateeventnotebysocket(note: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'UPDATE_EVENT_NOTE',
            payload: note,
        });
    };
}

export function updateprobebysocket(probe: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'UPDATE_PROBE',
            payload: probe,
        });
    };
}

export function incidentcreatedbysocket(incident: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'INCIDENT_CREATED',
            payload: incident,
        });
    };
}

export function deleteincidentbysocket(incident: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'INCIDENT_DELETED',
            payload: incident,
        });
    };
}

export function updateincidentbysocket(incident: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'INCIDENT_UPDATED',
            payload: incident,
        });
    };
}

export function addincidenttimelinebysocket(timeline: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'INCIDENT_TIMELINE_CREATED',
            payload: timeline,
        });
    };
}

export function deleteincidentnotebysocket(note: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'DELETE_INCIDENT_NOTE',
            payload: note,
        });
    };
}

export function resolvescheduledeventbysocket(event: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'RESOLVE_SCHEDULED_EVENT',
            payload: event,
        });
    };
}
export function updatestweetsbysocket(tweets: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'UPDATE_TWEETS',
            payload: tweets,
        });
    };
}
