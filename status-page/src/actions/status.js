import { getApi, postApi } from '../api';
import * as types from '../constants/status';
import errors from '../errors';
import { loginRequired, loginError } from '../actions/login';

export const statusPageSuccess = data => {
    return {
        type: types.STATUSPAGE_SUCCESS,
        payload: data,
    };
};

export const statusPageRequest = () => {
    return {
        type: types.STATUSPAGE_REQUEST,
    };
};

export const statusPageFailure = error => {
    return {
        type: types.STATUSPAGE_FAILURE,
        payload: error,
    };
};

// Calls the API to get status
export const getStatusPage = (statusPageId, url) => {
    return function(dispatch) {
        const promise = getApi(`statusPage/${statusPageId}?url=${url}`);

        dispatch(statusPageRequest());

        promise.then(
            Data => {
                dispatch(statusPageSuccess(Data.data));
            },
            error => {
                if (
                    error &&
                    error.response &&
                    error.response.status &&
                    error.response.status === 401
                ) {
                    dispatch(loginRequired(statusPageId));
                }
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                }
                if (error.length > 100) {
                    error = 'Network Error';
                }
                dispatch(statusPageFailure(errors(error)));
                dispatch(loginError(errors(error)));
            }
        );
        return promise;
    };
};

export const statusPageNoteSuccess = data => {
    return {
        type: types.STATUSPAGE_NOTES_SUCCESS,
        payload: data,
    };
};

export const statusPageNoteRequest = () => {
    return {
        type: types.STATUSPAGE_NOTES_REQUEST,
    };
};

export const statusPageNoteFailure = error => {
    return {
        type: types.STATUSPAGE_NOTES_FAILURE,
        payload: error,
    };
};

export const statusPageNoteReset = () => {
    return {
        type: types.STATUSPAGE_NOTES_RESET,
    };
};

export const individualNoteEnable = message => {
    return {
        type: types.INDIVIDUAL_NOTES_ENABLE,
        payload: message,
    };
};
export const individualNoteDisable = () => {
    return {
        type: types.INDIVIDUAL_NOTES_DISABLE,
    };
};

// Calls the API to get notes
export const getStatusPageNote = (projectId, statusPageId, skip) => {
    return function(dispatch) {
        const promise = getApi(
            `statusPage/${projectId}/${statusPageId}/notes?skip=${skip}`
        );

        dispatch(statusPageNoteRequest());

        promise.then(
            Data => {
                dispatch(statusPageNoteSuccess(Data.data));
                dispatch(individualNoteDisable());
            },
            error => {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                }
                if (error.length > 100) {
                    error = 'Network Error';
                }
                dispatch(statusPageNoteFailure(errors(error)));
            }
        );
    };
};

export const getStatusPageIndividualNote = (
    projectId,
    monitorId,
    date,
    name,
    need
) => {
    return function(dispatch) {
        const promise = getApi(
            `statusPage/${projectId}/${monitorId}/individualnotes?date=${date}&need=${need}`
        );

        dispatch(statusPageNoteRequest());

        promise.then(
            Data => {
                dispatch(statusPageNoteSuccess(Data.data));
                dispatch(
                    individualNoteEnable({
                        message: Data.data.message,
                        name: {
                            _id: monitorId,
                            name,
                            date,
                        },
                    })
                );
            },
            error => {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                }
                if (error.length > 100) {
                    error = 'Network Error';
                }
                dispatch(statusPageNoteFailure(errors(error)));
            }
        );
    };
};

export const scheduledEventSuccess = data => {
    return {
        type: types.SCHEDULED_EVENTS_SUCCESS,
        payload: data,
    };
};

export const scheduledEventRequest = () => {
    return {
        type: types.SCHEDULED_EVENTS_REQUEST,
    };
};

export const scheduledEventFailure = error => {
    return {
        type: types.SCHEDULED_EVENTS_FAILURE,
        payload: error,
    };
};

export const scheduledEventReset = () => {
    return {
        type: types.SCHEDULED_EVENTS_RESET,
    };
};

export const individualEventEnable = message => {
    return {
        type: types.INDIVIDUAL_EVENTS_ENABLE,
        payload: message,
    };
};
export const individualEventDisable = () => {
    return {
        type: types.INDIVIDUAL_EVENTS_DISABLE,
    };
};

// Calls the API to get events
export const getScheduledEvent = (projectId, statusPageId, skip) => {
    return function(dispatch) {
        const promise = getApi(
            `statusPage/${projectId}/${statusPageId}/events?skip=${skip}`
        );

        dispatch(scheduledEventRequest());

        promise.then(
            Data => {
                dispatch(scheduledEventSuccess(Data.data));
                dispatch(individualEventDisable());
            },
            error => {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                }
                if (error.length > 100) {
                    error = 'Network Error';
                }
                dispatch(scheduledEventFailure(errors(error)));
            }
        );
    };
};

export const getIndividualEvent = (projectId, monitorId, date, name) => {
    return function(dispatch) {
        const promise = getApi(
            `statusPage/${projectId}/${monitorId}/individualevents?date=${date}`
        );

        dispatch(scheduledEventRequest());

        promise.then(
            Data => {
                dispatch(scheduledEventSuccess(Data.data));
                dispatch(
                    individualEventEnable({
                        message: Data.data.message,
                        name: {
                            _id: monitorId,
                            name,
                            date,
                        },
                    })
                );
            },
            error => {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                }
                if (error.length > 100) {
                    error = 'Network Error';
                }
                dispatch(scheduledEventFailure(errors(error)));
            }
        );
    };
};

export const notmonitoredDays = (monitorId, date, name, message) => {
    return function(dispatch) {
        dispatch(statusPageNoteReset());
        dispatch(
            individualNoteEnable({
                message: message,
                name: {
                    _id: monitorId,
                    name,
                    date,
                },
            })
        );
    };
};

export const moreNoteSuccess = data => {
    return {
        type: types.MORE_NOTES_SUCCESS,
        payload: data,
    };
};

export const moreNoteRequest = () => {
    return {
        type: types.MORE_NOTES_REQUEST,
    };
};

export const moreNoteFailure = error => {
    return {
        type: types.MORE_NOTES_FAILURE,
        payload: error,
    };
};

export const getMoreNote = (projectId, statusPageId, skip) => {
    return function(dispatch) {
        const promise = getApi(
            `statusPage/${projectId}/${statusPageId}/notes?skip=${skip}`
        );

        dispatch(moreNoteRequest());
        promise.then(
            Data => {
                dispatch(moreNoteSuccess(Data.data));
            },
            error => {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                }
                if (error.length > 100) {
                    error = 'Network Error';
                }
                dispatch(moreNoteFailure(errors(error)));
            }
        );
    };
};

export const moreEventSuccess = data => {
    return {
        type: types.MORE_EVENTS_SUCCESS,
        payload: data,
    };
};

export const moreEventRequest = () => {
    return {
        type: types.MORE_EVENTS_REQUEST,
    };
};

export const moreEventFailure = error => {
    return {
        type: types.MORE_EVENTS_FAILURE,
        payload: error,
    };
};

export const getMoreEvent = (projectId, statusPageId, skip) => {
    return function(dispatch) {
        const promise = getApi(
            `statusPage/${projectId}/${statusPageId}/events?skip=${skip}`
        );

        dispatch(moreEventRequest());
        promise.then(
            Data => {
                dispatch(moreEventSuccess(Data.data));
            },
            error => {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                }
                if (error.length > 100) {
                    error = 'Network Error';
                }
                dispatch(moreEventFailure(errors(error)));
            }
        );
    };
};

export function selectedProbe(val) {
    return function(dispatch) {
        dispatch({
            type: types.SELECT_PROBE,
            payload: val,
        });
    };
}

// Fetch Monitor Statuses list
export function fetchMonitorStatuses(projectId, monitorId, startDate, endDate) {
    return function(dispatch) {
        const promise = postApi(
            `statusPage/${projectId}/${monitorId}/monitorStatuses`,
            { startDate, endDate }
        );
        dispatch(fetchMonitorStatusesRequest());

        promise.then(
            function(monitorStatuses) {
                dispatch(
                    fetchMonitorStatusesSuccess({
                        projectId,
                        monitorId,
                        statuses: monitorStatuses.data,
                    })
                );
            },
            function(error) {
                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(fetchMonitorStatusesFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function fetchMonitorStatusesRequest() {
    return {
        type: types.FETCH_MONITOR_STATUSES_REQUEST,
    };
}

export function fetchMonitorStatusesSuccess(monitorStatuses) {
    return {
        type: types.FETCH_MONITOR_STATUSES_SUCCESS,
        payload: monitorStatuses,
    };
}

export function fetchMonitorStatusesFailure(error) {
    return {
        type: types.FETCH_MONITOR_STATUSES_FAILURE,
        payload: error,
    };
}

export function fetchMonitorLogs(projectId, monitorId, data) {
    return function(dispatch) {
        const promise = postApi(
            `statusPage/${projectId}/${monitorId}/monitorLogs`,
            data
        );
        dispatch(fetchMonitorLogsRequest(monitorId));

        promise.then(
            function(monitorLogs) {
                dispatch(
                    fetchMonitorLogsSuccess({
                        monitorId,
                        logs: monitorLogs.data,
                    })
                );
            },
            function(error) {
                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(fetchMonitorLogsFailure(errors(error)));
            }
        );
        return promise;
    };
}

function fetchMonitorLogsRequest(monitorId) {
    return {
        type: types.FETCH_MONITOR_LOGS_REQUEST,
        payload: monitorId,
    };
}

function fetchMonitorLogsSuccess({ monitorId, logs }) {
    return {
        type: types.FETCH_MONITOR_LOGS_SUCCESS,
        payload: { monitorId, logs },
    };
}

function fetchMonitorLogsFailure(error) {
    return {
        type: types.FETCH_MONITOR_LOGS_FAILURE,
        payload: error,
    };
}

// Handle a scheduled event
export function fetchEventRequest() {
    return {
        type: types.FETCH_EVENT_REQUEST,
    };
}

export function fetchEventSuccess(payload) {
    return {
        type: types.FETCH_EVENT_SUCCESS,
        payload,
    };
}

export function fetchEventFailure(error) {
    return {
        type: types.FETCH_EVENT_FAILURE,
        payload: error,
    };
}

export function fetchEvent(projectId, scheduledEventId) {
    return async function(dispatch) {
        dispatch(fetchEventRequest());

        try {
            const response = await getApi(
                `statusPage/${projectId}/scheduledEvent/${scheduledEventId}`
            );
            dispatch(fetchEventSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(fetchEventFailure(errorMsg));
        }
    };
}

// Handle scheduled event note
export function fetchEventNoteRequest() {
    return {
        type: types.FETCH_EVENT_NOTES_REQUEST,
    };
}

export function fetchEventNoteSuccess(payload) {
    return {
        type: types.FETCH_EVENT_NOTES_SUCCESS,
        payload,
    };
}

export function fetchEventNoteFailure(error) {
    return {
        type: types.FETCH_EVENT_NOTES_FAILURE,
        payload: error,
    };
}

export function fetchEventNote(projectId, scheduledEventId, type) {
    return async function(dispatch) {
        dispatch(fetchEventNoteRequest());

        try {
            const response = await getApi(
                `statusPage/${projectId}/notes/${scheduledEventId}?type=${type}`
            );
            dispatch(fetchEventNoteSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(fetchEventNoteFailure(errorMsg));
        }
    };
}

export function moreEventNoteRequest() {
    return {
        type: types.MORE_EVENT_NOTE_REQUEST,
    };
}

export function moreEventNoteSuccess(payload) {
    return {
        type: types.MORE_EVENT_NOTE_SUCCESS,
        payload,
    };
}

export function moreEventNoteFailure(error) {
    return {
        type: types.MORE_EVENT_NOTE_FAILURE,
        payload: error,
    };
}

export function moreEventNote(projectId, scheduledEventId, type, skip) {
    return async function(dispatch) {
        try {
            dispatch(moreEventNoteRequest());

            const response = await getApi(
                `statusPage/${projectId}/notes/${scheduledEventId}?type=${type}&skip=${skip}`
            );
            dispatch(moreEventNoteSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(moreEventNoteFailure(errorMsg));
        }
    };
}

// handle incident
export function fetchIncidentRequest() {
    return {
        type: types.FETCH_INCIDENT_REQUEST,
    };
}

export function fetchIncidentSuccess(payload) {
    return {
        type: types.FETCH_INCIDENT_SUCCESS,
        payload,
    };
}

export function fetchIncidentFailure(error) {
    return {
        type: types.FETCH_INCIDENT_FAILURE,
        payload: error,
    };
}

export function fetchIncident(projectId, incidentId) {
    return async function(dispatch) {
        try {
            dispatch(fetchIncidentRequest());
            const response = await getApi(
                `statusPage/${projectId}/incident/${incidentId}`
            );

            dispatch(fetchIncidentSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(fetchIncidentFailure(errorMsg));
        }
    };
}

export function fetchIncidentNotesRequest() {
    return {
        type: types.FETCH_INCIDENT_NOTES_REQUEST,
    };
}

export function fetchIncidentNotesSuccess(payload) {
    return {
        type: types.FETCH_INCIDENT_NOTES_SUCCESS,
        payload,
    };
}

export function fetchIncidentNotesFailure(error) {
    return {
        type: types.FETCH_INCIDENT_NOTES_FAILURE,
        payload: error,
    };
}

export function fetchIncidentNotes(projectId, incidentId, type) {
    return async function(dispatch) {
        try {
            dispatch(fetchIncidentNotesRequest());

            const response = await getApi(
                `statusPage/${projectId}/${incidentId}/incidentNotes?type=${type}`
            );
            dispatch(fetchIncidentNotesSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(fetchIncidentNotesFailure(errorMsg));
        }
    };
}

export function moreIncidentNotesRequest() {
    return {
        type: types.MORE_INCIDENT_NOTES_REQUEST,
    };
}

export function moreIncidentNotesSuccess(payload) {
    return {
        type: types.MORE_INCIDENT_NOTES_SUCCESS,
        payload,
    };
}

export function moreIncidentNotesFailure(error) {
    return {
        type: types.MORE_INCIDENT_NOTES_FAILURE,
        payload: error,
    };
}

export function moreIncidentNotes(projectId, incidentId, type, skip) {
    return async function(dispatch) {
        try {
            dispatch(moreIncidentNotesRequest());

            const response = await getApi(
                `statusPage/${projectId}/${incidentId}/incidentNotes?type=${type}&skip=${skip}`
            );
            dispatch(moreIncidentNotesSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(moreIncidentNotesFailure(errorMsg));
        }
    };
}
