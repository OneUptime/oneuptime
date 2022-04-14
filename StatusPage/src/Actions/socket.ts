import { Dispatch } from 'redux';

export const updatestatuspagebysocket: Function = (
    statuspage: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'UPDATE_STATUS_PAGE',
            payload: statuspage,
        });
    };
};

export const updatemonitorbysocket: Function = (monitor: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'UPDATE_MONITOR',
            payload: monitor,
        });
    };
};

export const deletemonitorbysocket: Function = (monitor: $TSFixMe): void => {
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

export const addincidentnotebysocket: Function = (note: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'ADD_INCIDENT_NOTE',
            payload: note,
        });
    };
};

export const updateincidentnotebysocket: Function = (note: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'UPDATE_INCIDENT_NOTE',
            payload: note,
        });
    };
};

export const addscheduledeventbysocket: Function = (event: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'ADD_SCHEDULED_EVENT',
            payload: event,
        });
    };
};

export const deletescheduledeventbysocket: Function = (
    event: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'DELETE_SCHEDULED_EVENT',
            payload: event,
        });
    };
};

export const updatescheduledeventbysocket: Function = (
    event: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'UPDATE_SCHEDULED_EVENT',
            payload: event,
        });
    };
};

export const addeventnotebysocket: Function = (note: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'ADD_EVENT_NOTE',
            payload: note,
        });
    };
};

export const deleteeventnotebysocket: Function = (note: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'DELETE_EVENT_NOTE',
            payload: note,
        });
    };
};

export const updateeventnotebysocket: Function = (note: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'UPDATE_EVENT_NOTE',
            payload: note,
        });
    };
};

export const updateprobebysocket: Function = (probe: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'UPDATE_PROBE',
            payload: probe,
        });
    };
};

export const incidentcreatedbysocket: Function = (incident: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'INCIDENT_CREATED',
            payload: incident,
        });
    };
};

export const deleteincidentbysocket: Function = (incident: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'INCIDENT_DELETED',
            payload: incident,
        });
    };
};

export const updateincidentbysocket: Function = (incident: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'INCIDENT_UPDATED',
            payload: incident,
        });
    };
};

export const addincidenttimelinebysocket: Function = (
    timeline: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'INCIDENT_TIMELINE_CREATED',
            payload: timeline,
        });
    };
};

export const deleteincidentnotebysocket: Function = (note: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'DELETE_INCIDENT_NOTE',
            payload: note,
        });
    };
};

export const resolvescheduledeventbysocket: Function = (
    event: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'RESOLVE_SCHEDULED_EVENT',
            payload: event,
        });
    };
};
export const updatestweetsbysocket: Function = (tweets: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'UPDATE_TWEETS',
            payload: tweets,
        });
    };
};
