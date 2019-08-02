import {createMonitorSuccess,editMonitorSuccess} from './monitor';
import {teamUpdateRoleSuccess,teamCreateSuccess,teamDeleteSuccess} from './team';
import {changeProjectRoles} from './project';

// Resolve Incident
export function incidentresolvedbysocket(incident) {
    return function (dispatch) {
            dispatch({
                type: 'INCIDENT_RESOLVED_BY_SOCKET',
                payload: {data : incident}
            });
    };
}

// Acknowledge Incident
export function incidentacknowledgedbysocket(incident) {
    return function (dispatch) {
            dispatch({
                type: 'INCIDENT_ACKNOWLEDGED_BY_SOCKET',
                payload: {data :incident}
            });
    };
}

// Create new monitor
export function createmonitorbysocket(monitor) {
    return function (dispatch) {
        dispatch(createMonitorSuccess(monitor));
    };
}

// Edit monitor
export function updatemonitorbysocket(monitor) {
    return function (dispatch) {
        dispatch(editMonitorSuccess(monitor));
        dispatch({
            type: 'UPDATE_INCIDENTS_MONITOR_NAME',
            payload: monitor
        });
    };
}

//Delete Monitor
export function deletemonitorbysocket(monitor) {
    return function (dispatch) {
            dispatch({
                type: 'DELETE_MONITOR_BY_SOCKET',
                payload: monitor._id
            });
    };
}

export function incidentcreatedbysocket(incident) {
    return function (dispatch) {
            dispatch({
                type: 'ADD_NEW_INCIDENT_TO_UNRESOLVED',
                payload: incident
            });
            dispatch({
                type: 'ADD_NEW_INCIDENT_TO_MONITORS',
                payload: incident
            });
    };
}

export function updateresponsetime(time) {
    return function (dispatch) {
            dispatch({
                type: 'UPDATE_RESPONSE_TIME',
                payload: time
            });
    };
}

export function addnotifications(notification) {
    return function (dispatch) {
            dispatch({
                type: 'ADD_NOTIFICATION_BY_SOCKET',
                payload: notification
            });
    };
}

export function teamMemberRoleUpdate(data) {
    return function (dispatch) {
            dispatch(teamUpdateRoleSuccess(data));
            dispatch(changeProjectRoles(data));
    };
}

export function teamMemberCreate(data) {
    return function (dispatch) {
             dispatch(teamCreateSuccess(data));
    };
}

export function teamMemberDelete(data) {
    return function (dispatch) {
             dispatch(teamDeleteSuccess(data));
    };
}