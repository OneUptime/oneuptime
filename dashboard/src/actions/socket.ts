import { createMonitorSuccess, editMonitorSuccess } from './monitor';
import {
    teamUpdateRoleSuccess,
    teamCreateSuccess,
    teamDeleteSuccess,
} from './team';
import { changeProjectRoles } from './project';

// Resolve Incident
export const incidentresolvedbysocket = (incident: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
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
export const incidentacknowledgedbysocket = (incident: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
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
export const createmonitorbysocket = (monitor: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        dispatch(createMonitorSuccess(monitor));
    };
}

// Edit monitor
export const updatemonitorbysocket = (monitor: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        dispatch(editMonitorSuccess(monitor));
        dispatch({
            type: 'UPDATE_INCIDENTS_MONITOR_NAME',
            payload: monitor,
        });
    };
}

export const updatemonitorlogbysocket = (log: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'UPDATE_MONITOR_LOG',
            payload: log,
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

export const updateincidenttimelinebysocket = (incidentTimeline: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'UPDATE_INCIDENT_TIMELINE',
            payload: incidentTimeline,
        });
    };
}

export const updatelighthouselogbysocket = (log: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'UPDATE_LIGHTHOUSE_LOG',
            payload: log,
        });
    };
}

export const updateAlllighthouselogbysocket = (log: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'UPDATE_ALL_LIGHTHOUSE_LOG',
            payload: log,
        });
    };
}
export const updateprobebysocket = (probe: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'UPDATE_PROBE',
            payload: probe,
        });
    };
}

//Delete Monitor
export const deletemonitorbysocket = (monitor: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'DELETE_MONITOR_BY_SOCKET',
            payload: monitor._id,
        });
    };
}

export const incidentcreatedbysocket = (incident: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
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

export const addnotifications = (notification: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'ADD_NOTIFICATION_BY_SOCKET',
            payload: notification,
        });
    };
}

export const teamMemberRoleUpdate = (data: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        dispatch(teamUpdateRoleSuccess(data));
        dispatch(changeProjectRoles(data));
    };
}

export const teamMemberCreate = (data: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        dispatch(teamCreateSuccess(data));
    };
}

export const teamMemberDelete = (data: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        dispatch(teamDeleteSuccess(data));
    };
}

export const addIncidentNote = (data: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'ADD_INCIDENT_NOTE',
            payload: data,
        });
    };
}

export const createMonitor = (data: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'CREATE_MONITOR',
            payload: data,
        });
    };
}

export const updateincidentbysocket = (incident: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'UPDATE_INCIDENT',
            payload: incident,
        });
    };
}

export const deleteincidentbysocket = (incident: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'DELETE_INCIDENT',
            payload: incident,
        });
    };
}

export const resolvescheduledevent = (event: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'RESOLVE_SCHEDULED_EVENT_SUCCESS',
            payload: event,
        });
    };
}

export const slacountdown = ({ incident, countDown }: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'SLA_COUNT_DOWN',
            payload: { incident, countDown },
        });
    };
}

// Update Timeline
export const updateTimelineBySocket = (data: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'FETCH_INCIDENT_MESSAGES_SUCCESS',
            payload: data,
        });
    };
}
