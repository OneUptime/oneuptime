import { getApi, postApi } from '../api';
import * as types from '../constants/status';
import errors from '../errors';
import { loginRequired, loginError } from '../actions/login';
import { probeRequest } from './probe';

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
export const getStatusPage = (statusPageSlug, url) => {
    return function(dispatch) {
        const promise = getApi(`statusPage/${statusPageSlug}?url=${url}`);

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
                    dispatch(loginRequired(statusPageSlug));
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

// Calls the API to get all status page resources
export const getAllStatusPageResource = (statusPageSlug, url, range) => {
    return function(dispatch) {
        const promises = []; 

        promises.push(getApi(
            `statusPage/resources/${statusPageSlug}/ongoing-events?url=${url}&range=${range}`
        ));

        promises.push(getApi(
            `statusPage/resources/${statusPageSlug}/future-events?url=${url}&range=${range}`
        ));

        promises.push(getApi(
            `statusPage/resources/${statusPageSlug}/past-events?url=${url}&range=${range}`
        ));

        promises.push(getApi(
            `statusPage/resources/${statusPageSlug}/probes?url=${url}&range=${range}`
        ));
        
        promises.push(getApi(
            `statusPage/resources/${statusPageSlug}/monitor-logs?url=${url}&range=${range}`
        ));

        promises.push(getApi(
            `statusPage/resources/${statusPageSlug}/announcements?url=${url}&range=${range}`
        ));

        promises.push(getApi(
            `statusPage/resources/${statusPageSlug}/announcement-logs?url=${url}&range=${range}`
        ));

        promises.push(getApi(
            `statusPage/resources/${statusPageSlug}/timelines?url=${url}&range=${range}`
        ));

        promises.push(getApi(
            `statusPage/resources/${statusPageSlug}/notes?url=${url}&range=${range}`
        ));

        promises.push(getApi(
            `statusPage/resources/${statusPageSlug}/monitor-statuses?url=${url}&range=${range}`
        ));


        dispatch(statusPageRequest());
        dispatch(getAnnouncementsRequest());
        dispatch(fetchMonitorStatusesRequest());
        dispatch(fetchMonitorLogsRequest());
        dispatch(fetchLastIncidentTimelinesRequest());
        dispatch(statusPageNoteRequest());
        dispatch(fetchAnnouncementLogsRequest());
        dispatch(probeRequest());
        dispatch(ongoingEventRequest());
        dispatch(futureEventsRequest());
        dispatch(pastEventsRequest());

        return Promise.all(promises).then(
            ([ongoingEvents, futureEvents, pastEvents, probes, monitorLogs, announcement, announcementLogs, timelines, statusPageNote, monitorStatuses]) => {
                const data = {
                    ongoingEvents: ongoingEvents.data,
                    futureEvents: futureEvents.data, 
                    pastEvents: pastEvents.data,
                    probes: probes.data, 
                    monitorLogs: monitorLogs.data, 
                    announcement: announcement.data, 
                    announcementLogs: announcementLogs.data, 
                    timelines: timelines.data,
                    statusPageNote: statusPageNote.data, 
                    ...monitorStatuses.data
                };
                dispatch(getAllStatusPageSuccess(data));
            },
            error => {
                if (
                    error &&
                    error.response &&
                    error.response.status &&
                    error.response.status === 401
                ) {
                    dispatch(loginRequired(statusPageSlug));
                }

                if (error && error.response && error.response.data){
                    error = error.response.data;
                }

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

    };
};

export const getAllStatusPageSuccess = data => {
    return {
        type: types.FETCH_ALL_RESOURCES_SUCCESS,
        payload: data,
    };
};
export const statusPageNoteSuccess = data => {
    return {
        type: types.STATUSPAGE_NOTES_SUCCESS,
        payload: data,
    };
};

export const newThemeIncidentNote = data => {
    return {
        type: types.NEW_THEME_NOTES_SUCCESS,
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

export const showIncidentCard = payload => ({
    // payload => true or false
    type: types.SHOW_INCIDENT_CARD,
    payload,
});

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
export const getStatusPageNote = (
    projectId,
    statusPageSlug,
    skip,
    limit = 10,
    days = 14,
    newTheme = false
) => {
    return function(dispatch) {
        const promise = getApi(
            `statusPage/${projectId}/${statusPageSlug}/notes?skip=${skip}&limit=${limit}&days=${days}&newTheme=${newTheme}`
        );

        dispatch(statusPageNoteRequest());

        promise.then(
            Data => {
                dispatch(statusPageNoteSuccess(Data.data));
                dispatch(newThemeIncidentNote(Data.data));
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
    need,
    theme
) => {
    return function(dispatch) {
        const promise = getApi(
            `statusPage/${projectId}/${monitorId}/individualnotes?date=${date}&need=${need}&theme=${theme}`
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

// Calls the API to get events
export const getScheduledEvent = (
    projectId,
    statusPageSlug,
    skip,
    theme,
    days
) => {
    return function(dispatch) {
        const promise = getApi(
            `statusPage/${projectId}/${statusPageSlug}/events?skip=${skip}&theme=${theme}&days=${days}`
        );

        dispatch(scheduledEventRequest());

        promise.then(
            Data => {
                dispatch(scheduledEventSuccess(Data.data));
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

export const ongoingEventSuccess = data => {
    return {
        type: types.ONGOING_SCHEDULED_EVENTS_SUCCESS,
        payload: data,
    };
};

export const ongoingEventRequest = () => {
    return {
        type: types.ONGOING_SCHEDULED_EVENTS_REQUEST,
    };
};

export const ongoingEventFailure = error => {
    return {
        type: types.ONGOING_SCHEDULED_EVENTS_FAILURE,
        payload: error,
    };
};

export const ongoingEventReset = () => {
    return {
        type: types.ONGOING_SCHEDULED_EVENTS_RESET,
    };
};

// Calls the API to get events
export const getOngoingScheduledEvent = (
    projectId,
    statusPageSlug,
    skip,
    theme,
    limit
) => {
    return function(dispatch) {
        const promise = getApi(
            `statusPage/${projectId}/${statusPageSlug}/events?skip=${skip}&theme=${theme}&limit=${limit}`
        );

        dispatch(ongoingEventRequest());

        promise.then(
            Data => {
                dispatch(ongoingEventSuccess(Data.data));
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
                dispatch(ongoingEventFailure(errors(error)));
            }
        );
    };
};

export const individualEventsRequest = () => ({
    type: types.INDIVIDUAL_EVENTS_REQUEST,
});

export const individualEventsSuccess = payload => ({
    type: types.INDIVIDUAL_EVENTS_SUCCESS,
    payload,
});

export const individualEventsFailure = error => ({
    type: types.INDIVIDUAL_EVENTS_FAILURE,
    payload: error,
});

export const getIndividualEvent = (projectId, monitorId, date, name, theme) => {
    return function(dispatch) {
        const promise = getApi(
            `statusPage/${projectId}/${monitorId}/individualevents?date=${date}&theme=${theme}`
        );

        dispatch(individualEventsRequest());

        promise.then(
            Data => {
                dispatch(
                    individualEventsSuccess({
                        ...Data.data,
                        date,
                        monitorName: name,
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
                dispatch(individualEventsFailure(errors(error)));
            }
        );
    };
};

export const futureEventsRequest = () => ({
    type: types.FUTURE_EVENTS_REQUEST,
});

export const futureEventsSuccess = payload => ({
    type: types.FUTURE_EVENTS_SUCCESS,
    payload,
});

export const futureEventsFailure = error => ({
    type: types.FUTURE_EVENTS_FAILURE,
    payload: error,
});

export const fetchFutureEvents = (
    projectId,
    statusPageSlug,
    skip,
    theme,
    limit
) => async dispatch => {
    try {
        dispatch(futureEventsRequest());
        const response = await getApi(
            `statusPage/${projectId}/${statusPageSlug}/futureEvents?skip=${skip}&theme=${theme}&limit=${limit}`
        );
        dispatch(futureEventsSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(futureEventsFailure(errorMsg));
    }
};

export const pastEventsRequest = () => ({
    type: types.PAST_EVENTS_REQUEST,
});

export const pastEventsSuccess = payload => ({
    type: types.PAST_EVENTS_SUCCESS,
    payload,
});

export const pastEventsFailure = error => ({
    type: types.PAST_EVENTS_FAILURE,
    payload: error,
});

export const fetchPastEvents = (
    projectId,
    statusPageSlug,
    skip,
    theme,
    limit
) => async dispatch => {
    try {
        dispatch(pastEventsRequest());
        const response = await getApi(
            `statusPage/${projectId}/${statusPageSlug}/pastEvents?skip=${skip}&theme=${theme}&limit=${limit}`
        );
        dispatch(pastEventsSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(pastEventsFailure(errorMsg));
    }
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

export const getMoreNote = (projectId, statusPageSlug, skip) => {
    return function(dispatch) {
        const promise = getApi(
            `statusPage/${projectId}/${statusPageSlug}/notes?skip=${skip}`
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

export const getMoreEvent = (projectId, statusPageSlug, skip) => {
    return function(dispatch) {
        const promise = getApi(
            `statusPage/${projectId}/${statusPageSlug}/events?skip=${skip}`
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

export const moreFutureEventsRequest = () => ({
    type: types.MORE_FUTURE_EVENTS_REQUEST,
});

export const moreFutureEventsSuccess = payload => ({
    type: types.MORE_FUTURE_EVENTS_SUCCESS,
    payload,
});

export const moreFutureEventsFailure = error => ({
    type: types.MORE_FUTURE_EVENTS_FAILURE,
    payload: error,
});

export const fetchMoreFutureEvents = (
    projectId,
    statusPageSlug,
    skip,
    limit
) => async dispatch => {
    try {
        dispatch(moreFutureEventsRequest());
        const response = await getApi(
            `statusPage/${projectId}/${statusPageSlug}/futureEvents?skip=${skip}&limit=${limit}`
        );
        dispatch(moreFutureEventsSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(moreFutureEventsFailure(errorMsg));
    }
};

export const morePastEventsRequest = () => ({
    type: types.MORE_PAST_EVENTS_REQUEST,
});

export const morePastEventsSuccess = payload => ({
    type: types.MORE_PAST_EVENTS_SUCCESS,
    payload,
});

export const morePastEventsFailure = error => ({
    type: types.MORE_PAST_EVENTS_FAILURE,
    payload: error,
});

export const fetchMorePastEvents = (
    projectId,
    statusPageSlug,
    skip
) => async dispatch => {
    try {
        dispatch(morePastEventsRequest());
        const response = await getApi(
            `statusPage/${projectId}/${statusPageSlug}/pastEvents?skip=${skip}`
        );
        dispatch(morePastEventsSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(morePastEventsFailure(errorMsg));
    }
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
        dispatch(fetchMonitorStatusesRequest(monitorId));

        promise.then(
            // eslint-disable-next-line no-unused-vars
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

export function fetchMonitorStatusesRequest(id) {
    return {
        type: types.FETCH_MONITOR_STATUSES_REQUEST,
        payload: id,
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

export function fetchEventNote(projectId, scheduledEventSlug, type) {
    return async function(dispatch) {
        dispatch(fetchEventNoteRequest());

        try {
            const response = await getApi(
                `statusPage/${projectId}/notes/${scheduledEventSlug}?type=${type}`
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

export function fetchIncident(projectId, incidentSlug) {
    return async function(dispatch) {
        try {
            dispatch(fetchIncidentRequest());
            const response = await getApi(
                `statusPage/${projectId}/incident/${incidentSlug}`
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

export function fetchIncidentNotes(projectId, incidentId, postOnStatusPage) {
    return async function(dispatch) {
        try {
            dispatch(fetchIncidentNotesRequest());

            const response = await getApi(
                `statusPage/${projectId}/${incidentId}/incidentNotes?postOnStatusPage=${postOnStatusPage}`
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

export function moreIncidentNotes(
    projectId,
    incidentSlug,
    postOnStatusPage,
    skip
) {
    return async function(dispatch) {
        try {
            dispatch(moreIncidentNotesRequest());

            const response = await getApi(
                `statusPage/${projectId}/${incidentSlug}/incidentNotes?postOnStatusPage=${postOnStatusPage}&skip=${skip}`
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

export function fetchLastIncidentTimelineRequest() {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINE_REQUEST,
    };
}

export function fetchLastIncidentTimelineSuccess(payload) {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINE_SUCCESS,
        payload,
    };
}

export function fetchLastIncidentTimelineFailure(error) {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINE_FAILURE,
        payload: error,
    };
}

export function fetchLastIncidentTimeline(projectId, incidentSlug) {
    return async function(dispatch) {
        try {
            dispatch(fetchLastIncidentTimelineRequest());

            const response = await getApi(
                `statusPage/${projectId}/timeline/${incidentSlug}`
            );
            dispatch(fetchLastIncidentTimelineSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(fetchLastIncidentTimelineFailure(errorMsg));
        }
    };
}

export function fetchLastIncidentTimelinesRequest() {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINES_REQUEST,
    };
}

export function fetchLastIncidentTimelinesSuccess(payload) {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINES_SUCCESS,
        payload,
    };
}

export function fetchLastIncidentTimelinesFailure(error) {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINES_FAILURE,
        payload: error,
    };
}

export function fetchLastIncidentTimelines(projectId, statusPageSlug) {
    return async function(dispatch) {
        try {
            dispatch(fetchLastIncidentTimelinesRequest());

            const response = await getApi(
                `statusPage/${projectId}/${statusPageSlug}/timelines`
            );
            dispatch(fetchLastIncidentTimelinesSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(fetchLastIncidentTimelinesFailure(errorMsg));
        }
    };
}

export function showEventCard(payload) {
    // payload => true or false
    return {
        type: types.SHOW_EVENT_CARD,
        payload,
    };
}

export function getAnnouncementsRequest() {
    return {
        type: types.FETCH_ANNOUNCEMENTS_REQUEST,
    };
}

export function getAnnouncementsSuccess(data) {
    return {
        type: types.FETCH_ANNOUNCEMENTS_SUCCESS,
        payload: data,
    };
}

export function getAnnouncementsFailure(data) {
    return {
        type: types.FETCH_ANNOUNCEMENTS_FAILURE,
        payload: data,
    };
}

export function getAnnouncements(projectId, statusPageId, skip = 0, limit) {
    return function(dispatch) {
        const promise = getApi(
            `statusPage/${projectId}/announcement/${statusPageId}?skip=${skip}&limit=${limit}&show=true`
        );
        dispatch(getAnnouncementsRequest());
        promise.then(
            function(response) {
                dispatch(getAnnouncementsSuccess(response.data));
            },
            function(error) {
                const errorMsg =
                    error.response && error.response.data
                        ? error.response.data
                        : error.data
                        ? error.data
                        : error.message
                        ? error.message
                        : 'Network Error';
                dispatch(getAnnouncementsFailure(errorMsg));
            }
        );
        return promise;
    };
}

export function getSingleAnnouncementSuccess(data) {
    return {
        type: types.FETCH_SINGLE_ANNOUNCEMENTS_SUCCESS,
        payload: data,
    };
}

export function getSingleAnnouncementRequest() {
    return {
        type: types.FETCH_SINGLE_ANNOUNCEMENTS_REQUEST,
    };
}

export function getSingleAnnouncementFailure(error) {
    return {
        type: types.FETCH_SINGLE_ANNOUNCEMENTS_FAILURE,
        payload: error,
    };
}

export function getSingleAnnouncement(
    projectId,
    statusPageSlug,
    announcementSlug
) {
    return function(dispatch) {
        const promise = getApi(
            `statusPage/${projectId}/announcement/${statusPageSlug}/single/${announcementSlug}`
        );
        dispatch(getSingleAnnouncementRequest());
        promise.then(
            function(response) {
                dispatch(getSingleAnnouncementSuccess(response.data));
            },
            function(error) {
                const errorMsg =
                    error.response && error.response.data
                        ? error.response.data
                        : error.data
                        ? error.data
                        : error.message
                        ? error.message
                        : 'Network Error';
                dispatch(getSingleAnnouncementFailure(errorMsg));
            }
        );
        return promise;
    };
}

export function fetchAnnouncementLogsRequest() {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_REQUEST,
    };
}

export function fetchAnnouncementLogsSuccess(data) {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_SUCCESS,
        payload: data,
    };
}

export function fetchAnnouncementLogsFailure(error) {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_FAILURE,
        payload: error,
    };
}

export function fetchAnnouncementLogs(
    projectId,
    statusPageId,
    skip = 0,
    limit
) {
    return function(dispatch) {
        const promise = getApi(
            `statusPage/${projectId}/announcementLogs/${statusPageId}?skip=${skip}&limit=${limit}&theme=${true}`
        );
        dispatch(fetchAnnouncementLogsRequest());
        promise.then(
            function(response) {
                dispatch(fetchAnnouncementLogsSuccess(response.data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(fetchAnnouncementLogsFailure(error));
            }
        );
        return promise;
    };
}

export function calculateTimeRequest(monitorId) {
    return {
        type: types.CALCULATE_TIME_REQUEST,
        payload: monitorId,
    };
}

export function calculateTimeSuccess(payload) {
    return {
        type: types.CALCULATE_TIME_SUCCESS,
        payload,
    };
}

export function calculateTimeFailure(error) {
    return {
        type: types.CALCULATE_TIME_FAILURE,
        payload: error,
    };
}

export function calculateTime(statuses, start, range, monitorId) {
    return function(dispatch) {
        const promise = postApi(`monitor/${monitorId}/calculate-time`, {
            statuses,
            start,
            range,
        });
        dispatch(calculateTimeRequest(monitorId));
        promise.then(
            function(response) {
                dispatch(calculateTimeSuccess(response.data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(calculateTimeFailure(error));
            }
        );
        return promise;
    };
}

export function fetchTweetsRequest(monitorId) {
    return {
        type: types.FETCH_TWEETS_REQUEST,
        payload: monitorId,
    };
}

export function fetchTweetsSuccess(payload) {
    return {
        type: types.FETCH_TWEETS_SUCCESS,
        payload,
    };
}

export function fetchTweetsFailure(error) {
    return {
        type: types.FETCH_TWEETS_FAILURE,
        payload: error,
    };
}

export function fetchTweets(handle, projectId) {
    return function(dispatch) {
        const promise = postApi(`statusPage/${projectId}/tweets`, {
            handle,
        });

        dispatch(fetchTweetsRequest());
        promise.then(
            function(response) {
                dispatch(fetchTweetsSuccess(response.data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(fetchTweetsFailure(error));
            }
        );
        return promise;
    };
}

export function fetchExternalStatusPagesRequest() {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_REQUEST,
    };
}

export function fetchExternalStatusPagesSuccess(payload) {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_SUCCESS,
        payload,
    };
}

export function fetchExternalStatusPagesFailure(error) {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_FAILURE,
        payload: error,
    };
}

export function fetchExternalStatusPages(projectId, statusPageId) {
    return function(dispatch) {
        const promise = getApi(
            `statusPage/${projectId}/fetchExternalStatusPages/${statusPageId}`
        );

        dispatch(fetchExternalStatusPagesRequest());
        promise.then(
            function(response) {
                dispatch(fetchExternalStatusPagesSuccess(response.data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(fetchExternalStatusPagesFailure(error));
            }
        );
        return promise;
    };
}
export function translateLanguage(payload) {
    return {
        type: types.TRANSLATE_LANGUAGE,
        payload,
    };
}
