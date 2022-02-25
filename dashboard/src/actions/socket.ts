import { createMonitorSuccess, editMonitorSuccess } from './monitor';
import {
    teamUpdateRoleSuccess,
    teamCreateSuccess,
    teamDeleteSuccess,
} from './team';
import { changeProjectRoles } from './project';

// Resolve Incident
export function incidentresolvedbysocket(incident) {
    return function(dispatch) {
        dispatch({
            type: 'INCIDENT_RESOLVED_BY_SOCKET',
            payload: { data: incident },
        });
        dispatch({
            type: 'RESOLVE_INCIDENT_SUCCESS',
            payload: incident,
        });
    };
}

// Acknowledge Incident
export function incidentacknowledgedbysocket(incident) {
    return function(dispatch) {
        dispatch({
            type: 'INCIDENT_ACKNOWLEDGED_BY_SOCKET',
            payload: { data: incident },
        });
        dispatch({
            type: 'ACKNOWLEDGE_INCIDENT_SUCCESS',
            payload: incident,
        });
    };
}

// Create new monitor
export function createmonitorbysocket(monitor) {
    return function(dispatch) {
        dispatch(createMonitorSuccess(monitor));
    };
}

// Edit monitor
export function updatemonitorbysocket(monitor) {
    return function(dispatch) {
        dispatch(editMonitorSuccess(monitor));
        dispatch({
            type: 'UPDATE_INCIDENTS_MONITOR_NAME',
            payload: monitor,
        });
    };
}

export function updatemonitorlogbysocket(log) {
    return function(dispatch) {
        dispatch({
            type: 'UPDATE_MONITOR_LOG',
            payload: log,
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

export function updateincidenttimelinebysocket(incidentTimeline) {
    return function(dispatch) {
        dispatch({
            type: 'UPDATE_INCIDENT_TIMELINE',
            payload: incidentTimeline,
        });
    };
}

export function updatelighthouselogbysocket(log) {
    return function(dispatch) {
        dispatch({
            type: 'UPDATE_LIGHTHOUSE_LOG',
            payload: log,
        });
    };
}

export function updateAlllighthouselogbysocket(log) {
    return function(dispatch) {
        dispatch({
            type: 'UPDATE_ALL_LIGHTHOUSE_LOG',
            payload: log,
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

//Delete Monitor
export function deletemonitorbysocket(monitor) {
    return function(dispatch) {
        dispatch({
            type: 'DELETE_MONITOR_BY_SOCKET',
            payload: monitor._id,
        });
    };
}

export function incidentcreatedbysocket(incident) {
    return function(dispatch) {
        dispatch({
            type: 'ADD_NEW_INCIDENT_TO_UNRESOLVED',
            payload: incident,
        });
        dispatch({
            type: 'ADD_NEW_INCIDENT_TO_MONITORS',
            payload: incident,
        });
    };
}

export function addnotifications(notification) {
    return function(dispatch) {
        dispatch({
            type: 'ADD_NOTIFICATION_BY_SOCKET',
            payload: notification,
        });
    };
}

export function teamMemberRoleUpdate(data) {
    return function(dispatch) {
        dispatch(teamUpdateRoleSuccess(data));
        dispatch(changeProjectRoles(data));
    };
}

export function teamMemberCreate(data) {
    return function(dispatch) {
        dispatch(teamCreateSuccess(data));
    };
}

export function teamMemberDelete(data) {
    return function(dispatch) {
        dispatch(teamDeleteSuccess(data));
    };
}

export function addIncidentNote(data) {
    return function(dispatch) {
        dispatch({
            type: 'ADD_INCIDENT_NOTE',
            payload: data,
        });
    };
}

export function createMonitor(data) {
    return function(dispatch) {
        dispatch({
            type: 'CREATE_MONITOR',
            payload: data,
        });
    };
}

export function updateincidentbysocket(incident) {
    return function(dispatch) {
        dispatch({
            type: 'UPDATE_INCIDENT',
            payload: incident,
        });
    };
}

export function deleteincidentbysocket(incident) {
    return function(dispatch) {
        dispatch({
            type: 'DELETE_INCIDENT',
            payload: incident,
        });
    };
}

export function resolvescheduledevent(event) {
    return function(dispatch) {
        dispatch({
            type: 'RESOLVE_SCHEDULED_EVENT_SUCCESS',
            payload: event,
        });
    };
}

export function slacountdown({ incident, countDown }) {
    return function(dispatch) {
        dispatch({
            type: 'SLA_COUNT_DOWN',
            payload: { incident, countDown },
        });
    };
}

// Update Timeline
export function updateTimelineBySocket(data) {
    return function(dispatch) {
        dispatch({
            type: 'FETCH_INCIDENT_MESSAGES_SUCCESS',
            payload: data,
        });
    };
}
