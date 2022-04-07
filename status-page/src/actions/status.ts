import BackendAPI from 'common-ui/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/status';
import ErrorPayload from 'common-ui/src/payload-types/error';
import PositiveNumber from 'common/types/PositiveNumber';
import { loginRequired, loginError } from '../actions/login';
import { probeRequest } from './probe';

export const statusPageSuccess = (data: $TSFixMe) => {
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

export const statusPageFailure = (error: ErrorPayload) => {
    return {
        type: types.STATUSPAGE_FAILURE,
        payload: error,
    };
};

// Calls the API to get status
export const getStatusPage = (statusPageSlug: $TSFixMe, url: URL) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `status-page/${statusPageSlug}?url=${url}`
        );

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
                dispatch(statusPageFailure(error));
                dispatch(loginError(error));
            }
        );
        return promise;
    };
};

// Calls the API to get all status page resources
export const getAllStatusPageResource = (
    statusPageSlug: $TSFixMe,
    url: URL,
    range: $TSFixMe
) => {
    return function (dispatch: Dispatch) {
        const promises = [];

        promises.push(
            BackendAPI.get(
                `status-page/resources/${statusPageSlug}/ongoing-events?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `status-page/resources/${statusPageSlug}/future-events?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `status-page/resources/${statusPageSlug}/past-events?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `status-page/resources/${statusPageSlug}/probes?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `status-page/resources/${statusPageSlug}/monitor-logs?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `status-page/resources/${statusPageSlug}/announcements?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `status-page/resources/${statusPageSlug}/announcement-logs?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `status-page/resources/${statusPageSlug}/monitor-timelines?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `status-page/resources/${statusPageSlug}/statuspage-notes?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `status-page/resources/${statusPageSlug}/monitor-statuses?url=${url}&range=${range}`
            )
        );

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
            ([
                ongoingEvents,
                futureEvents,
                pastEvents,
                probes,
                monitorLogs,
                announcement,
                announcementLogs,
                timelines,
                statusPageNote,
                monitorStatuses,
            ]) => {
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

                    ...monitorStatuses.data,
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

                if (error && error.response && error.response.data) {
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

                dispatch(statusPageFailure(error));
                dispatch(loginError(error));
            }
        );
    };
};

export const getAllStatusPageSuccess = (data: $TSFixMe) => {
    return {
        type: types.FETCH_ALL_RESOURCES_SUCCESS,
        payload: data,
    };
};
export const statusPageNoteSuccess = (data: $TSFixMe) => {
    return {
        type: types.STATUSPAGE_NOTES_SUCCESS,
        payload: data,
    };
};

export const newThemeIncidentNote = (data: $TSFixMe) => {
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

export const statusPageNoteFailure = (error: ErrorPayload) => {
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

export const showIncidentCard = (payload: $TSFixMe) => ({
    // payload => true or false
    type: types.SHOW_INCIDENT_CARD,

    payload,
});

export const individualNoteEnable = (message: $TSFixMe) => {
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
    projectId: string,
    statusPageSlug: $TSFixMe,
    skip: PositiveNumber,
    limit = 10,
    days = 14,
    newTheme = false
) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `status-page/${projectId}/${statusPageSlug}/notes?skip=${skip}&limit=${limit}&days=${days}&newTheme=${newTheme}`
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
                dispatch(statusPageNoteFailure(error));
            }
        );
    };
};

export const getStatusPageIndividualNote = (
    projectId: string,
    monitorId: $TSFixMe,
    date: $TSFixMe,
    name: $TSFixMe,
    need: $TSFixMe,
    theme: $TSFixMe
) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `status-page/${projectId}/${monitorId}/individualnotes?date=${date}&need=${need}&theme=${theme}`
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
                dispatch(statusPageNoteFailure(error));
            }
        );
    };
};

export const scheduledEventSuccess = (data: $TSFixMe) => {
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

export const scheduledEventFailure = (error: ErrorPayload) => {
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
    projectId: string,
    statusPageSlug: $TSFixMe,
    skip: PositiveNumber,
    theme: $TSFixMe,
    days: $TSFixMe
) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `status-page/${projectId}/${statusPageSlug}/events?skip=${skip}&theme=${theme}&days=${days}`
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
                dispatch(scheduledEventFailure(error));
            }
        );
    };
};

export const ongoingEventSuccess = (data: $TSFixMe) => {
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

export const ongoingEventFailure = (error: ErrorPayload) => {
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
    projectId: string,
    statusPageSlug: $TSFixMe,
    skip: PositiveNumber,
    theme: $TSFixMe,
    limit: PositiveNumber
) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `status-page/${projectId}/${statusPageSlug}/events?skip=${skip}&theme=${theme}&limit=${limit}`
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
                dispatch(ongoingEventFailure(error));
            }
        );
    };
};

export const individualEventsRequest = () => ({
    type: types.INDIVIDUAL_EVENTS_REQUEST,
});

export const individualEventsSuccess = (payload: $TSFixMe) => ({
    type: types.INDIVIDUAL_EVENTS_SUCCESS,
    payload,
});

export const individualEventsFailure = (error: ErrorPayload) => ({
    type: types.INDIVIDUAL_EVENTS_FAILURE,
    payload: error,
});

export const getIndividualEvent = (
    projectId: string,
    monitorId: $TSFixMe,
    date: $TSFixMe,
    name: $TSFixMe,
    theme: $TSFixMe
) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `status-page/${projectId}/${monitorId}/individualevents?date=${date}&theme=${theme}`
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
                dispatch(individualEventsFailure(error));
            }
        );
    };
};

export const futureEventsRequest = () => ({
    type: types.FUTURE_EVENTS_REQUEST,
});

export const futureEventsSuccess = (payload: $TSFixMe) => ({
    type: types.FUTURE_EVENTS_SUCCESS,
    payload,
});

export const futureEventsFailure = (error: ErrorPayload) => ({
    type: types.FUTURE_EVENTS_FAILURE,
    payload: error,
});

export const fetchFutureEvents =
    (
        projectId: string,
        statusPageSlug: $TSFixMe,
        skip: PositiveNumber,
        theme: $TSFixMe,
        limit: PositiveNumber
    ) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(futureEventsRequest());
            const response = await BackendAPI.get(
                `status-page/${projectId}/${statusPageSlug}/futureEvents?skip=${skip}&theme=${theme}&limit=${limit}`
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

export const pastEventsSuccess = (payload: $TSFixMe) => ({
    type: types.PAST_EVENTS_SUCCESS,
    payload,
});

export const pastEventsFailure = (error: ErrorPayload) => ({
    type: types.PAST_EVENTS_FAILURE,
    payload: error,
});

export const fetchPastEvents =
    (
        projectId: string,
        statusPageSlug: $TSFixMe,
        skip: PositiveNumber,
        theme: $TSFixMe,
        limit: PositiveNumber
    ) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(pastEventsRequest());
            const response = await BackendAPI.get(
                `status-page/${projectId}/${statusPageSlug}/pastEvents?skip=${skip}&theme=${theme}&limit=${limit}`
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

export const notmonitoredDays = (
    monitorId: $TSFixMe,
    date: $TSFixMe,
    name: $TSFixMe,
    message: $TSFixMe
) => {
    return function (dispatch: Dispatch) {
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

export const moreNoteSuccess = (data: $TSFixMe) => {
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

export const moreNoteFailure = (error: ErrorPayload) => {
    return {
        type: types.MORE_NOTES_FAILURE,
        payload: error,
    };
};

export const getMoreNote = (
    projectId: string,
    statusPageSlug: $TSFixMe,
    skip: PositiveNumber
) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `status-page/${projectId}/${statusPageSlug}/notes?skip=${skip}`
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
                dispatch(moreNoteFailure(error));
            }
        );
    };
};

export const moreEventSuccess = (data: $TSFixMe) => {
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

export const moreEventFailure = (error: ErrorPayload) => {
    return {
        type: types.MORE_EVENTS_FAILURE,
        payload: error,
    };
};

export const getMoreEvent = (
    projectId: string,
    statusPageSlug: $TSFixMe,
    skip: PositiveNumber
) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `status-page/${projectId}/${statusPageSlug}/events?skip=${skip}`
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
                dispatch(moreEventFailure(error));
            }
        );
    };
};

export const moreFutureEventsRequest = () => ({
    type: types.MORE_FUTURE_EVENTS_REQUEST,
});

export const moreFutureEventsSuccess = (payload: $TSFixMe) => ({
    type: types.MORE_FUTURE_EVENTS_SUCCESS,
    payload,
});

export const moreFutureEventsFailure = (error: ErrorPayload) => ({
    type: types.MORE_FUTURE_EVENTS_FAILURE,
    payload: error,
});

export const fetchMoreFutureEvents =
    (
        projectId: string,
        statusPageSlug: $TSFixMe,
        skip: PositiveNumber,
        limit: PositiveNumber
    ) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(moreFutureEventsRequest());
            const response = await BackendAPI.get(
                `status-page/${projectId}/${statusPageSlug}/futureEvents?skip=${skip}&limit=${limit}`
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

export const morePastEventsSuccess = (payload: $TSFixMe) => ({
    type: types.MORE_PAST_EVENTS_SUCCESS,
    payload,
});

export const morePastEventsFailure = (error: ErrorPayload) => ({
    type: types.MORE_PAST_EVENTS_FAILURE,
    payload: error,
});

export const fetchMorePastEvents =
    (projectId: string, statusPageSlug: $TSFixMe, skip: PositiveNumber) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(morePastEventsRequest());
            const response = await BackendAPI.get(
                `status-page/${projectId}/${statusPageSlug}/pastEvents?skip=${skip}`
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

export const selectedProbe = (val: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: types.SELECT_PROBE,
            payload: val,
        });
    };
};

// Fetch Monitor Statuses list
export function fetchMonitorStatuses(
    projectId: string,
    monitorId: $TSFixMe,
    startDate: $TSFixMe,
    endDate: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(
            `status-page/${projectId}/${monitorId}/monitorStatuses`,
            { startDate, endDate }
        );
        dispatch(fetchMonitorStatusesRequest(monitorId));

        promise.then(
            function (monitorStatuses) {
                dispatch(
                    fetchMonitorStatusesSuccess({
                        projectId,
                        monitorId,

                        statuses: monitorStatuses.data,
                    })
                );
            },
            function (error) {
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
                dispatch(fetchMonitorStatusesFailure(error));
            }
        );

        return promise;
    };
}

export const fetchMonitorStatusesRequest = (id: $TSFixMe) => {
    return {
        type: types.FETCH_MONITOR_STATUSES_REQUEST,
        payload: id,
    };
};

export const fetchMonitorStatusesSuccess = (monitorStatuses: $TSFixMe) => {
    return {
        type: types.FETCH_MONITOR_STATUSES_SUCCESS,
        payload: monitorStatuses,
    };
};

export const fetchMonitorStatusesFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_MONITOR_STATUSES_FAILURE,
        payload: error,
    };
};

export function fetchMonitorLogs(
    projectId: string,
    monitorId: $TSFixMe,
    data: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(
            `status-page/${projectId}/${monitorId}/monitorLogs`,
            data
        );
        dispatch(fetchMonitorLogsRequest(monitorId));

        promise.then(
            function (monitorLogs) {
                dispatch(
                    fetchMonitorLogsSuccess({
                        monitorId,

                        logs: monitorLogs.data,
                    })
                );
            },
            function (error) {
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
                dispatch(fetchMonitorLogsFailure(error));
            }
        );
        return promise;
    };
}

function fetchMonitorLogsRequest(monitorId: $TSFixMe) {
    return {
        type: types.FETCH_MONITOR_LOGS_REQUEST,
        payload: monitorId,
    };
}

function fetchMonitorLogsSuccess({ monitorId, logs }: $TSFixMe) {
    return {
        type: types.FETCH_MONITOR_LOGS_SUCCESS,
        payload: { monitorId, logs },
    };
}

function fetchMonitorLogsFailure(error: ErrorPayload) {
    return {
        type: types.FETCH_MONITOR_LOGS_FAILURE,
        payload: error,
    };
}

// Handle a scheduled event
export const fetchEventRequest = () => {
    return {
        type: types.FETCH_EVENT_REQUEST,
    };
};

export const fetchEventSuccess = (payload: $TSFixMe) => {
    return {
        type: types.FETCH_EVENT_SUCCESS,
        payload,
    };
};

export const fetchEventFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_EVENT_FAILURE,
        payload: error,
    };
};

export const fetchEvent = (projectId: string, scheduledEventId: $TSFixMe) => {
    return async function (dispatch: Dispatch) {
        dispatch(fetchEventRequest());

        try {
            const response = await BackendAPI.get(
                `status-page/${projectId}/scheduledEvent/${scheduledEventId}`
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
};

// Handle scheduled event note
export const fetchEventNoteRequest = () => {
    return {
        type: types.FETCH_EVENT_NOTES_REQUEST,
    };
};

export const fetchEventNoteSuccess = (payload: $TSFixMe) => {
    return {
        type: types.FETCH_EVENT_NOTES_SUCCESS,
        payload,
    };
};

export const fetchEventNoteFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_EVENT_NOTES_FAILURE,
        payload: error,
    };
};

export function fetchEventNote(
    projectId: string,
    scheduledEventSlug: $TSFixMe,
    type: $TSFixMe
) {
    return async function (dispatch: Dispatch) {
        dispatch(fetchEventNoteRequest());

        try {
            const response = await BackendAPI.get(
                `status-page/${projectId}/notes/${scheduledEventSlug}?type=${type}`
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

export const moreEventNoteRequest = () => {
    return {
        type: types.MORE_EVENT_NOTE_REQUEST,
    };
};

export const moreEventNoteSuccess = (payload: $TSFixMe) => {
    return {
        type: types.MORE_EVENT_NOTE_SUCCESS,
        payload,
    };
};

export const moreEventNoteFailure = (error: ErrorPayload) => {
    return {
        type: types.MORE_EVENT_NOTE_FAILURE,
        payload: error,
    };
};

export function moreEventNote(
    projectId: string,
    scheduledEventId: $TSFixMe,
    type: $TSFixMe,
    skip: PositiveNumber
) {
    return async function (dispatch: Dispatch) {
        try {
            dispatch(moreEventNoteRequest());

            const response = await BackendAPI.get(
                `status-page/${projectId}/notes/${scheduledEventId}?type=${type}&skip=${skip}`
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
export const fetchIncidentRequest = () => {
    return {
        type: types.FETCH_INCIDENT_REQUEST,
    };
};

export const fetchIncidentSuccess = (payload: $TSFixMe) => {
    return {
        type: types.FETCH_INCIDENT_SUCCESS,
        payload,
    };
};

export const fetchIncidentFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_INCIDENT_FAILURE,
        payload: error,
    };
};

export const fetchIncident = (projectId: string, incidentSlug: $TSFixMe) => {
    return async function (dispatch: Dispatch) {
        try {
            dispatch(fetchIncidentRequest());
            const response = await BackendAPI.get(
                `status-page/${projectId}/incident/${incidentSlug}`
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
};

export const fetchIncidentNotesRequest = () => {
    return {
        type: types.FETCH_INCIDENT_NOTES_REQUEST,
    };
};

export const fetchIncidentNotesSuccess = (payload: $TSFixMe) => {
    return {
        type: types.FETCH_INCIDENT_NOTES_SUCCESS,
        payload,
    };
};

export const fetchIncidentNotesFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_INCIDENT_NOTES_FAILURE,
        payload: error,
    };
};

export function fetchIncidentNotes(
    projectId: string,
    incidentId: $TSFixMe,
    postOnStatusPage: $TSFixMe
) {
    return async function (dispatch: Dispatch) {
        try {
            dispatch(fetchIncidentNotesRequest());

            const response = await BackendAPI.get(
                `status-page/${projectId}/${incidentId}/incidentNotes?postOnStatusPage=${postOnStatusPage}`
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

export const moreIncidentNotesRequest = () => {
    return {
        type: types.MORE_INCIDENT_NOTES_REQUEST,
    };
};

export const moreIncidentNotesSuccess = (payload: $TSFixMe) => {
    return {
        type: types.MORE_INCIDENT_NOTES_SUCCESS,
        payload,
    };
};

export const moreIncidentNotesFailure = (error: ErrorPayload) => {
    return {
        type: types.MORE_INCIDENT_NOTES_FAILURE,
        payload: error,
    };
};

export function moreIncidentNotes(
    projectId: string,
    incidentSlug: $TSFixMe,
    postOnStatusPage: $TSFixMe,
    skip: PositiveNumber
) {
    return async function (dispatch: Dispatch) {
        try {
            dispatch(moreIncidentNotesRequest());

            const response = await BackendAPI.get(
                `status-page/${projectId}/${incidentSlug}/incidentNotes?postOnStatusPage=${postOnStatusPage}&skip=${skip}`
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

export const fetchLastIncidentTimelineRequest = () => {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINE_REQUEST,
    };
};

export const fetchLastIncidentTimelineSuccess = (payload: $TSFixMe) => {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINE_SUCCESS,
        payload,
    };
};

export const fetchLastIncidentTimelineFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINE_FAILURE,
        payload: error,
    };
};

export function fetchLastIncidentTimeline(
    projectId: string,
    incidentSlug: $TSFixMe
) {
    return async function (dispatch: Dispatch) {
        try {
            dispatch(fetchLastIncidentTimelineRequest());

            const response = await BackendAPI.get(
                `status-page/${projectId}/timeline/${incidentSlug}`
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

export const fetchLastIncidentTimelinesRequest = () => {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINES_REQUEST,
    };
};

export const fetchLastIncidentTimelinesSuccess = (payload: $TSFixMe) => {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINES_SUCCESS,
        payload,
    };
};

export const fetchLastIncidentTimelinesFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINES_FAILURE,
        payload: error,
    };
};

export function fetchLastIncidentTimelines(
    projectId: string,
    statusPageSlug: $TSFixMe
) {
    return async function (dispatch: Dispatch) {
        try {
            dispatch(fetchLastIncidentTimelinesRequest());

            const response = await BackendAPI.get(
                `status-page/${projectId}/${statusPageSlug}/timelines`
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

export const showEventCard = (payload: $TSFixMe) => {
    // payload => true or false
    return {
        type: types.SHOW_EVENT_CARD,
        payload,
    };
};

export const getAnnouncementsRequest = () => {
    return {
        type: types.FETCH_ANNOUNCEMENTS_REQUEST,
    };
};

export const getAnnouncementsSuccess = (data: $TSFixMe) => {
    return {
        type: types.FETCH_ANNOUNCEMENTS_SUCCESS,
        payload: data,
    };
};

export const getAnnouncementsFailure = (data: $TSFixMe) => {
    return {
        type: types.FETCH_ANNOUNCEMENTS_FAILURE,
        payload: data,
    };
};

export function getAnnouncements(
    projectId: string,
    statusPageId: $TSFixMe,
    skip = 0,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `status-page/${projectId}/announcement/${statusPageId}?skip=${skip}&limit=${limit}&show=true`
        );
        dispatch(getAnnouncementsRequest());
        promise.then(
            function (response) {
                dispatch(getAnnouncementsSuccess(response.data));
            },
            function (error) {
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

export const getSingleAnnouncementSuccess = (data: $TSFixMe) => {
    return {
        type: types.FETCH_SINGLE_ANNOUNCEMENTS_SUCCESS,
        payload: data,
    };
};

export const getSingleAnnouncementRequest = () => {
    return {
        type: types.FETCH_SINGLE_ANNOUNCEMENTS_REQUEST,
    };
};

export const getSingleAnnouncementFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_SINGLE_ANNOUNCEMENTS_FAILURE,
        payload: error,
    };
};

export function getSingleAnnouncement(
    projectId: string,
    statusPageSlug: $TSFixMe,
    announcementSlug: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `status-page/${projectId}/announcement/${statusPageSlug}/single/${announcementSlug}`
        );
        dispatch(getSingleAnnouncementRequest());
        promise.then(
            function (response) {
                dispatch(getSingleAnnouncementSuccess(response.data));
            },
            function (error) {
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

export const fetchAnnouncementLogsRequest = () => {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_REQUEST,
    };
};

export const fetchAnnouncementLogsSuccess = (data: $TSFixMe) => {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_SUCCESS,
        payload: data,
    };
};

export const fetchAnnouncementLogsFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_FAILURE,
        payload: error,
    };
};

export function fetchAnnouncementLogs(
    projectId: string,
    statusPageId: $TSFixMe,
    skip = 0,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `status-page/${projectId}/announcementLogs/${statusPageId}?skip=${skip}&limit=${limit}&theme=${true}`
        );
        dispatch(fetchAnnouncementLogsRequest());
        promise.then(
            function (response) {
                dispatch(fetchAnnouncementLogsSuccess(response.data));
            },
            function (error) {
                dispatch(fetchAnnouncementLogsFailure(error));
            }
        );
        return promise;
    };
}

export const calculateTimeRequest = (monitorId: $TSFixMe) => {
    return {
        type: types.CALCULATE_TIME_REQUEST,
        payload: monitorId,
    };
};

export const calculateTimeSuccess = (payload: $TSFixMe) => {
    return {
        type: types.CALCULATE_TIME_SUCCESS,
        payload,
    };
};

export const calculateTimeFailure = (error: ErrorPayload) => {
    return {
        type: types.CALCULATE_TIME_FAILURE,
        payload: error,
    };
};

export function calculateTime(
    statuses: $TSFixMe,
    start: $TSFixMe,
    range: $TSFixMe,
    monitorId: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(`monitor/${monitorId}/calculate-time`, {
            statuses,
            start,
            range,
        });
        dispatch(calculateTimeRequest(monitorId));
        promise.then(
            function (response) {
                dispatch(calculateTimeSuccess(response.data));
            },
            function (error) {
                dispatch(calculateTimeFailure(error));
            }
        );
        return promise;
    };
}

export const fetchTweetsRequest = (monitorId: $TSFixMe) => {
    return {
        type: types.FETCH_TWEETS_REQUEST,
        payload: monitorId,
    };
};

export const fetchTweetsSuccess = (payload: $TSFixMe) => {
    return {
        type: types.FETCH_TWEETS_SUCCESS,
        payload,
    };
};

export const fetchTweetsFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_TWEETS_FAILURE,
        payload: error,
    };
};

export const fetchTweets = (handle: $TSFixMe, projectId: string) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(`status-page/${projectId}/tweets`, {
            handle,
        });

        dispatch(fetchTweetsRequest());
        promise.then(
            function (response) {
                dispatch(fetchTweetsSuccess(response.data));
            },
            function (error) {
                dispatch(fetchTweetsFailure(error));
            }
        );
        return promise;
    };
};

export const fetchExternalStatusPagesRequest = () => {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_REQUEST,
    };
};

export const fetchExternalStatusPagesSuccess = (payload: $TSFixMe) => {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_SUCCESS,
        payload,
    };
};

export const fetchExternalStatusPagesFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_FAILURE,
        payload: error,
    };
};

export function fetchExternalStatusPages(
    projectId: string,
    statusPageId: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `status-page/${projectId}/fetchExternalStatusPages/${statusPageId}`
        );

        dispatch(fetchExternalStatusPagesRequest());
        promise.then(
            function (response) {
                dispatch(fetchExternalStatusPagesSuccess(response.data));
            },
            function (error) {
                dispatch(fetchExternalStatusPagesFailure(error));
            }
        );
        return promise;
    };
}
export const translateLanguage = (payload: $TSFixMe) => {
    return {
        type: types.TRANSLATE_LANGUAGE,
        payload,
    };
};
