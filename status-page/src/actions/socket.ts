import { Dispatch } from 'redux';

export const updatestatuspagebysocket = (statuspage: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: 'UPDATE_STATUS_PAGE',
            payload: statuspage,
        });
    };
};

export const updatemonitorbysocket = (monitor: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: 'UPDATE_MONITOR',
            payload: monitor,
        });
    };
};

export const deletemonitorbysocket = (monitor: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: 'DELETE_MONITOR',
            payload: monitor._id,
        });
    };
};

export function updatemonitorstatusbysocket(
    status: $TSFixMe,
    probes: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        dispatch({
            type: 'UPDATE_MONITOR_STATUS',
            payload: { status, probes },
        });
    };
}

export const addincidentnotebysocket = (note: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: 'ADD_INCIDENT_NOTE',
            payload: note,
        });
    };
};

export const updateincidentnotebysocket = (note: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: 'UPDATE_INCIDENT_NOTE',
            payload: note,
        });
    };
};

export const addscheduledeventbysocket = (event: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: 'ADD_SCHEDULED_EVENT',
            payload: event,
        });
    };
};

export const deletescheduledeventbysocket = (event: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: 'DELETE_SCHEDULED_EVENT',
            payload: event,
        });
    };
};

export const updatescheduledeventbysocket = (event: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: 'UPDATE_SCHEDULED_EVENT',
            payload: event,
        });
    };
};

export const addeventnotebysocket = (note: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: 'ADD_EVENT_NOTE',
            payload: note,
        });
    };
};

export const deleteeventnotebysocket = (note: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: 'DELETE_EVENT_NOTE',
            payload: note,
        });
    };
};

export const updateeventnotebysocket = (note: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: 'UPDATE_EVENT_NOTE',
            payload: note,
        });
    };
};

export const updateprobebysocket = (probe: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: 'UPDATE_PROBE',
            payload: probe,
        });
    };
};

export const incidentcreatedbysocket = (incident: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: 'INCIDENT_CREATED',
            payload: incident,
        });
    };
};

export const deleteincidentbysocket = (incident: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: 'INCIDENT_DELETED',
            payload: incident,
        });
    };
};

export const updateincidentbysocket = (incident: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: 'INCIDENT_UPDATED',
            payload: incident,
        });
    };
};

export const addincidenttimelinebysocket = (timeline: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: 'INCIDENT_TIMELINE_CREATED',
            payload: timeline,
        });
    };
};

export const deleteincidentnotebysocket = (note: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: 'DELETE_INCIDENT_NOTE',
            payload: note,
        });
    };
};

export const resolvescheduledeventbysocket = (event: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: 'RESOLVE_SCHEDULED_EVENT',
            payload: event,
        });
    };
};
export const updatestweetsbysocket = (tweets: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: 'UPDATE_TWEETS',
            payload: tweets,
        });
    };
};
