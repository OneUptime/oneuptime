import { Dispatch } from 'redux';

export const updatestatuspagebysocket = (statuspage: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'UPDATE_STATUS_PAGE',
            payload: statuspage,
        });
    };
};

export const updatemonitorbysocket = (monitor: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'UPDATE_MONITOR',
            payload: monitor,
        });
    };
};

export const deletemonitorbysocket = (monitor: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'DELETE_MONITOR',
            payload: monitor._id,
        });
    };
};

export function updatemonitorstatusbysocket(
    status: $TSFixMe,
    probes: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'UPDATE_MONITOR_STATUS',
            payload: { status, probes },
        });
    };
}

export const addincidentnotebysocket = (note: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'ADD_INCIDENT_NOTE',
            payload: note,
        });
    };
};

export const updateincidentnotebysocket = (note: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'UPDATE_INCIDENT_NOTE',
            payload: note,
        });
    };
};

export const addscheduledeventbysocket = (event: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'ADD_SCHEDULED_EVENT',
            payload: event,
        });
    };
};

export const deletescheduledeventbysocket = (event: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'DELETE_SCHEDULED_EVENT',
            payload: event,
        });
    };
};

export const updatescheduledeventbysocket = (event: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'UPDATE_SCHEDULED_EVENT',
            payload: event,
        });
    };
};

export const addeventnotebysocket = (note: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'ADD_EVENT_NOTE',
            payload: note,
        });
    };
};

export const deleteeventnotebysocket = (note: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'DELETE_EVENT_NOTE',
            payload: note,
        });
    };
};

export const updateeventnotebysocket = (note: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'UPDATE_EVENT_NOTE',
            payload: note,
        });
    };
};

export const updateprobebysocket = (probe: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'UPDATE_PROBE',
            payload: probe,
        });
    };
};

export const incidentcreatedbysocket = (incident: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'INCIDENT_CREATED',
            payload: incident,
        });
    };
};

export const deleteincidentbysocket = (incident: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'INCIDENT_DELETED',
            payload: incident,
        });
    };
};

export const updateincidentbysocket = (incident: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'INCIDENT_UPDATED',
            payload: incident,
        });
    };
};

export const addincidenttimelinebysocket = (timeline: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'INCIDENT_TIMELINE_CREATED',
            payload: timeline,
        });
    };
};

export const deleteincidentnotebysocket = (note: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'DELETE_INCIDENT_NOTE',
            payload: note,
        });
    };
};

export const resolvescheduledeventbysocket = (event: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'RESOLVE_SCHEDULED_EVENT',
            payload: event,
        });
    };
};
export const updatestweetsbysocket = (tweets: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'UPDATE_TWEETS',
            payload: tweets,
        });
    };
};
