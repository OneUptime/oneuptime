import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/status';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
import { loginRequired, loginError } from './login';
import { probeRequest } from './probe';

export const statusPageSuccess = (data: $TSFixMe): void => {
    return {
        type: types.STATUSPAGE_SUCCESS,
        payload: data,
    };
};

export const statusPageRequest = (): void => {
    return {
        type: types.STATUSPAGE_REQUEST,
    };
};

export const statusPageFailure = (error: ErrorPayload): void => {
    return {
        type: types.STATUSPAGE_FAILURE,
        payload: error,
    };
};

// Calls the API to get status
export const getStatusPage = (statusPageSlug: $TSFixMe, url: URL): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `StatusPage/${statusPageSlug}?url=${url}`
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
): void => {
    return function (dispatch: Dispatch): void {
        const promises = [];

        promises.push(
            BackendAPI.get(
                `StatusPage/resources/${statusPageSlug}/ongoing-events?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `StatusPage/resources/${statusPageSlug}/future-events?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `StatusPage/resources/${statusPageSlug}/past-events?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `StatusPage/resources/${statusPageSlug}/probes?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `StatusPage/resources/${statusPageSlug}/monitor-logs?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `StatusPage/resources/${statusPageSlug}/announcements?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `StatusPage/resources/${statusPageSlug}/announcement-logs?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `StatusPage/resources/${statusPageSlug}/monitor-timelines?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `StatusPage/resources/${statusPageSlug}/statuspage-notes?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `StatusPage/resources/${statusPageSlug}/monitor-statuses?url=${url}&range=${range}`
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

export const getAllStatusPageSuccess = (data: $TSFixMe): void => {
    return {
        type: types.FETCH_ALL_RESOURCES_SUCCESS,
        payload: data,
    };
};
export const statusPageNoteSuccess = (data: $TSFixMe): void => {
    return {
        type: types.STATUSPAGE_NOTES_SUCCESS,
        payload: data,
    };
};

export const newThemeIncidentNote = (data: $TSFixMe): void => {
    return {
        type: types.NEW_THEME_NOTES_SUCCESS,
        payload: data,
    };
};

export const statusPageNoteRequest = (): void => {
    return {
        type: types.STATUSPAGE_NOTES_REQUEST,
    };
};

export const statusPageNoteFailure = (error: ErrorPayload): void => {
    return {
        type: types.STATUSPAGE_NOTES_FAILURE,
        payload: error,
    };
};

export const statusPageNoteReset = (): void => {
    return {
        type: types.STATUSPAGE_NOTES_RESET,
    };
};

export const showIncidentCard = (payload: $TSFixMe): void => ({
    // payload => true or false
    type: types.SHOW_INCIDENT_CARD,

    payload,
});

export const individualNoteEnable = (message: $TSFixMe): void => {
    return {
        type: types.INDIVIDUAL_NOTES_ENABLE,
        payload: message,
    };
};
export const individualNoteDisable = (): void => {
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
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `StatusPage/${projectId}/${statusPageSlug}/notes?skip=${skip}&limit=${limit}&days=${days}&newTheme=${newTheme}`
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
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `StatusPage/${projectId}/${monitorId}/individualnotes?date=${date}&need=${need}&theme=${theme}`
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

export const scheduledEventSuccess = (data: $TSFixMe): void => {
    return {
        type: types.SCHEDULED_EVENTS_SUCCESS,
        payload: data,
    };
};

export const scheduledEventRequest = (): void => {
    return {
        type: types.SCHEDULED_EVENTS_REQUEST,
    };
};

export const scheduledEventFailure = (error: ErrorPayload): void => {
    return {
        type: types.SCHEDULED_EVENTS_FAILURE,
        payload: error,
    };
};

export const scheduledEventReset = (): void => {
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
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `StatusPage/${projectId}/${statusPageSlug}/events?skip=${skip}&theme=${theme}&days=${days}`
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

export const ongoingEventSuccess = (data: $TSFixMe): void => {
    return {
        type: types.ONGOING_SCHEDULED_EVENTS_SUCCESS,
        payload: data,
    };
};

export const ongoingEventRequest = (): void => {
    return {
        type: types.ONGOING_SCHEDULED_EVENTS_REQUEST,
    };
};

export const ongoingEventFailure = (error: ErrorPayload): void => {
    return {
        type: types.ONGOING_SCHEDULED_EVENTS_FAILURE,
        payload: error,
    };
};

export const ongoingEventReset = (): void => {
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
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `StatusPage/${projectId}/${statusPageSlug}/events?skip=${skip}&theme=${theme}&limit=${limit}`
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

export const individualEventsRequest = (): void => ({
    type: types.INDIVIDUAL_EVENTS_REQUEST,
});

export const individualEventsSuccess = (payload: $TSFixMe): void => ({
    type: types.INDIVIDUAL_EVENTS_SUCCESS,
    payload,
});

export const individualEventsFailure = (error: ErrorPayload): void => ({
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
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `StatusPage/${projectId}/${monitorId}/individualevents?date=${date}&theme=${theme}`
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

export const futureEventsRequest = (): void => ({
    type: types.FUTURE_EVENTS_REQUEST,
});

export const futureEventsSuccess = (payload: $TSFixMe): void => ({
    type: types.FUTURE_EVENTS_SUCCESS,
    payload,
});

export const futureEventsFailure = (error: ErrorPayload): void => ({
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
                `StatusPage/${projectId}/${statusPageSlug}/futureEvents?skip=${skip}&theme=${theme}&limit=${limit}`
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

export const pastEventsRequest = (): void => ({
    type: types.PAST_EVENTS_REQUEST,
});

export const pastEventsSuccess = (payload: $TSFixMe): void => ({
    type: types.PAST_EVENTS_SUCCESS,
    payload,
});

export const pastEventsFailure = (error: ErrorPayload): void => ({
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
                `StatusPage/${projectId}/${statusPageSlug}/pastEvents?skip=${skip}&theme=${theme}&limit=${limit}`
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
): void => {
    return function (dispatch: Dispatch): void {
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

export const moreNoteSuccess = (data: $TSFixMe): void => {
    return {
        type: types.MORE_NOTES_SUCCESS,
        payload: data,
    };
};

export const moreNoteRequest = (): void => {
    return {
        type: types.MORE_NOTES_REQUEST,
    };
};

export const moreNoteFailure = (error: ErrorPayload): void => {
    return {
        type: types.MORE_NOTES_FAILURE,
        payload: error,
    };
};

export const getMoreNote = (
    projectId: string,
    statusPageSlug: $TSFixMe,
    skip: PositiveNumber
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `StatusPage/${projectId}/${statusPageSlug}/notes?skip=${skip}`
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

export const moreEventSuccess = (data: $TSFixMe): void => {
    return {
        type: types.MORE_EVENTS_SUCCESS,
        payload: data,
    };
};

export const moreEventRequest = (): void => {
    return {
        type: types.MORE_EVENTS_REQUEST,
    };
};

export const moreEventFailure = (error: ErrorPayload): void => {
    return {
        type: types.MORE_EVENTS_FAILURE,
        payload: error,
    };
};

export const getMoreEvent = (
    projectId: string,
    statusPageSlug: $TSFixMe,
    skip: PositiveNumber
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `StatusPage/${projectId}/${statusPageSlug}/events?skip=${skip}`
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

export const moreFutureEventsRequest = (): void => ({
    type: types.MORE_FUTURE_EVENTS_REQUEST,
});

export const moreFutureEventsSuccess = (payload: $TSFixMe): void => ({
    type: types.MORE_FUTURE_EVENTS_SUCCESS,
    payload,
});

export const moreFutureEventsFailure = (error: ErrorPayload): void => ({
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
                `StatusPage/${projectId}/${statusPageSlug}/futureEvents?skip=${skip}&limit=${limit}`
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

export const morePastEventsRequest = (): void => ({
    type: types.MORE_PAST_EVENTS_REQUEST,
});

export const morePastEventsSuccess = (payload: $TSFixMe): void => ({
    type: types.MORE_PAST_EVENTS_SUCCESS,
    payload,
});

export const morePastEventsFailure = (error: ErrorPayload): void => ({
    type: types.MORE_PAST_EVENTS_FAILURE,
    payload: error,
});

export const fetchMorePastEvents =
    (projectId: string, statusPageSlug: $TSFixMe, skip: PositiveNumber) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(morePastEventsRequest());
            const response = await BackendAPI.get(
                `StatusPage/${projectId}/${statusPageSlug}/pastEvents?skip=${skip}`
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

export const selectedProbe = (val: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
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
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
            `StatusPage/${projectId}/${monitorId}/monitorStatuses`,
            { startDate, endDate }
        );
        dispatch(fetchMonitorStatusesRequest(monitorId));

        promise.then(
            function (monitorStatuses): void {
                dispatch(
                    fetchMonitorStatusesSuccess({
                        projectId,
                        monitorId,

                        statuses: monitorStatuses.data,
                    })
                );
            },
            function (error): void {
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

export const fetchMonitorStatusesRequest = (id: $TSFixMe): void => {
    return {
        type: types.FETCH_MONITOR_STATUSES_REQUEST,
        payload: id,
    };
};

export const fetchMonitorStatusesSuccess = (
    monitorStatuses: $TSFixMe
): void => {
    return {
        type: types.FETCH_MONITOR_STATUSES_SUCCESS,
        payload: monitorStatuses,
    };
};

export const fetchMonitorStatusesFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_MONITOR_STATUSES_FAILURE,
        payload: error,
    };
};

export function fetchMonitorLogs(
    projectId: string,
    monitorId: $TSFixMe,
    data: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
            `StatusPage/${projectId}/${monitorId}/monitorLogs`,
            data
        );
        dispatch(fetchMonitorLogsRequest(monitorId));

        promise.then(
            function (monitorLogs): void {
                dispatch(
                    fetchMonitorLogsSuccess({
                        monitorId,

                        logs: monitorLogs.data,
                    })
                );
            },
            function (error): void {
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

function fetchMonitorLogsRequest(monitorId: $TSFixMe): void {
    return {
        type: types.FETCH_MONITOR_LOGS_REQUEST,
        payload: monitorId,
    };
}

function fetchMonitorLogsSuccess({ monitorId, logs }: $TSFixMe): void {
    return {
        type: types.FETCH_MONITOR_LOGS_SUCCESS,
        payload: { monitorId, logs },
    };
}

function fetchMonitorLogsFailure(error: ErrorPayload): void {
    return {
        type: types.FETCH_MONITOR_LOGS_FAILURE,
        payload: error,
    };
}

// Handle a scheduled event
export const fetchEventRequest = (): void => {
    return {
        type: types.FETCH_EVENT_REQUEST,
    };
};

export const fetchEventSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_EVENT_SUCCESS,
        payload,
    };
};

export const fetchEventFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_EVENT_FAILURE,
        payload: error,
    };
};

export const fetchEvent = (
    projectId: string,
    scheduledEventId: $TSFixMe
): void => {
    return async function (dispatch: Dispatch): void {
        dispatch(fetchEventRequest());

        try {
            const response = await BackendAPI.get(
                `StatusPage/${projectId}/scheduledEvent/${scheduledEventId}`
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
export const fetchEventNoteRequest = (): void => {
    return {
        type: types.FETCH_EVENT_NOTES_REQUEST,
    };
};

export const fetchEventNoteSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_EVENT_NOTES_SUCCESS,
        payload,
    };
};

export const fetchEventNoteFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_EVENT_NOTES_FAILURE,
        payload: error,
    };
};

export function fetchEventNote(
    projectId: string,
    scheduledEventSlug: $TSFixMe,
    type: $TSFixMe
): void {
    return async function (dispatch: Dispatch): void {
        dispatch(fetchEventNoteRequest());

        try {
            const response = await BackendAPI.get(
                `StatusPage/${projectId}/notes/${scheduledEventSlug}?type=${type}`
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

export const moreEventNoteRequest = (): void => {
    return {
        type: types.MORE_EVENT_NOTE_REQUEST,
    };
};

export const moreEventNoteSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.MORE_EVENT_NOTE_SUCCESS,
        payload,
    };
};

export const moreEventNoteFailure = (error: ErrorPayload): void => {
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
    return async function (dispatch: Dispatch): void {
        try {
            dispatch(moreEventNoteRequest());

            const response = await BackendAPI.get(
                `StatusPage/${projectId}/notes/${scheduledEventId}?type=${type}&skip=${skip}`
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
export const fetchIncidentRequest = (): void => {
    return {
        type: types.FETCH_INCIDENT_REQUEST,
    };
};

export const fetchIncidentSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_INCIDENT_SUCCESS,
        payload,
    };
};

export const fetchIncidentFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_INCIDENT_FAILURE,
        payload: error,
    };
};

export const fetchIncident = (
    projectId: string,
    incidentSlug: $TSFixMe
): void => {
    return async function (dispatch: Dispatch): void {
        try {
            dispatch(fetchIncidentRequest());
            const response = await BackendAPI.get(
                `StatusPage/${projectId}/incident/${incidentSlug}`
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

export const fetchIncidentNotesRequest = (): void => {
    return {
        type: types.FETCH_INCIDENT_NOTES_REQUEST,
    };
};

export const fetchIncidentNotesSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_INCIDENT_NOTES_SUCCESS,
        payload,
    };
};

export const fetchIncidentNotesFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_INCIDENT_NOTES_FAILURE,
        payload: error,
    };
};

export function fetchIncidentNotes(
    projectId: string,
    incidentId: $TSFixMe,
    postOnStatusPage: $TSFixMe
): void {
    return async function (dispatch: Dispatch): void {
        try {
            dispatch(fetchIncidentNotesRequest());

            const response = await BackendAPI.get(
                `StatusPage/${projectId}/${incidentId}/incidentNotes?postOnStatusPage=${postOnStatusPage}`
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

export const moreIncidentNotesRequest = (): void => {
    return {
        type: types.MORE_INCIDENT_NOTES_REQUEST,
    };
};

export const moreIncidentNotesSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.MORE_INCIDENT_NOTES_SUCCESS,
        payload,
    };
};

export const moreIncidentNotesFailure = (error: ErrorPayload): void => {
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
    return async function (dispatch: Dispatch): void {
        try {
            dispatch(moreIncidentNotesRequest());

            const response = await BackendAPI.get(
                `StatusPage/${projectId}/${incidentSlug}/incidentNotes?postOnStatusPage=${postOnStatusPage}&skip=${skip}`
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

export const fetchLastIncidentTimelineRequest = (): void => {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINE_REQUEST,
    };
};

export const fetchLastIncidentTimelineSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINE_SUCCESS,
        payload,
    };
};

export const fetchLastIncidentTimelineFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINE_FAILURE,
        payload: error,
    };
};

export function fetchLastIncidentTimeline(
    projectId: string,
    incidentSlug: $TSFixMe
): void {
    return async function (dispatch: Dispatch): void {
        try {
            dispatch(fetchLastIncidentTimelineRequest());

            const response = await BackendAPI.get(
                `StatusPage/${projectId}/timeline/${incidentSlug}`
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

export const fetchLastIncidentTimelinesRequest = (): void => {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINES_REQUEST,
    };
};

export const fetchLastIncidentTimelinesSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINES_SUCCESS,
        payload,
    };
};

export const fetchLastIncidentTimelinesFailure = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINES_FAILURE,
        payload: error,
    };
};

export function fetchLastIncidentTimelines(
    projectId: string,
    statusPageSlug: $TSFixMe
): void {
    return async function (dispatch: Dispatch): void {
        try {
            dispatch(fetchLastIncidentTimelinesRequest());

            const response = await BackendAPI.get(
                `StatusPage/${projectId}/${statusPageSlug}/timelines`
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

export const showEventCard = (payload: $TSFixMe): void => {
    // payload => true or false
    return {
        type: types.SHOW_EVENT_CARD,
        payload,
    };
};

export const getAnnouncementsRequest = (): void => {
    return {
        type: types.FETCH_ANNOUNCEMENTS_REQUEST,
    };
};

export const getAnnouncementsSuccess = (data: $TSFixMe): void => {
    return {
        type: types.FETCH_ANNOUNCEMENTS_SUCCESS,
        payload: data,
    };
};

export const getAnnouncementsFailure = (data: $TSFixMe): void => {
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
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `StatusPage/${projectId}/announcement/${statusPageId}?skip=${skip}&limit=${limit}&show=true`
        );
        dispatch(getAnnouncementsRequest());
        promise.then(
            function (response): void {
                dispatch(getAnnouncementsSuccess(response.data));
            },
            function (error): void {
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

export const getSingleAnnouncementSuccess = (data: $TSFixMe): void => {
    return {
        type: types.FETCH_SINGLE_ANNOUNCEMENTS_SUCCESS,
        payload: data,
    };
};

export const getSingleAnnouncementRequest = (): void => {
    return {
        type: types.FETCH_SINGLE_ANNOUNCEMENTS_REQUEST,
    };
};

export const getSingleAnnouncementFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_SINGLE_ANNOUNCEMENTS_FAILURE,
        payload: error,
    };
};

export function getSingleAnnouncement(
    projectId: string,
    statusPageSlug: $TSFixMe,
    announcementSlug: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `StatusPage/${projectId}/announcement/${statusPageSlug}/single/${announcementSlug}`
        );
        dispatch(getSingleAnnouncementRequest());
        promise.then(
            function (response): void {
                dispatch(getSingleAnnouncementSuccess(response.data));
            },
            function (error): void {
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

export const fetchAnnouncementLogsRequest = (): void => {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_REQUEST,
    };
};

export const fetchAnnouncementLogsSuccess = (data: $TSFixMe): void => {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_SUCCESS,
        payload: data,
    };
};

export const fetchAnnouncementLogsFailure = (error: ErrorPayload): void => {
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
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `StatusPage/${projectId}/announcementLogs/${statusPageId}?skip=${skip}&limit=${limit}&theme=${true}`
        );
        dispatch(fetchAnnouncementLogsRequest());
        promise.then(
            function (response): void {
                dispatch(fetchAnnouncementLogsSuccess(response.data));
            },
            function (error): void {
                dispatch(fetchAnnouncementLogsFailure(error));
            }
        );
        return promise;
    };
}

export const calculateTimeRequest = (monitorId: $TSFixMe): void => {
    return {
        type: types.CALCULATE_TIME_REQUEST,
        payload: monitorId,
    };
};

export const calculateTimeSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.CALCULATE_TIME_SUCCESS,
        payload,
    };
};

export const calculateTimeFailure = (error: ErrorPayload): void => {
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
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(`monitor/${monitorId}/calculate-time`, {
            statuses,
            start,
            range,
        });
        dispatch(calculateTimeRequest(monitorId));
        promise.then(
            function (response): void {
                dispatch(calculateTimeSuccess(response.data));
            },
            function (error): void {
                dispatch(calculateTimeFailure(error));
            }
        );
        return promise;
    };
}

export const fetchTweetsRequest = (monitorId: $TSFixMe): void => {
    return {
        type: types.FETCH_TWEETS_REQUEST,
        payload: monitorId,
    };
};

export const fetchTweetsSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_TWEETS_SUCCESS,
        payload,
    };
};

export const fetchTweetsFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_TWEETS_FAILURE,
        payload: error,
    };
};

export const fetchTweets = (handle: $TSFixMe, projectId: string): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(`StatusPage/${projectId}/tweets`, {
            handle,
        });

        dispatch(fetchTweetsRequest());
        promise.then(
            function (response): void {
                dispatch(fetchTweetsSuccess(response.data));
            },
            function (error): void {
                dispatch(fetchTweetsFailure(error));
            }
        );
        return promise;
    };
};

export const fetchExternalStatusPagesRequest = (): void => {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_REQUEST,
    };
};

export const fetchExternalStatusPagesSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_SUCCESS,
        payload,
    };
};

export const fetchExternalStatusPagesFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_FAILURE,
        payload: error,
    };
};

export function fetchExternalStatusPages(
    projectId: string,
    statusPageId: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `StatusPage/${projectId}/fetchExternalStatusPages/${statusPageId}`
        );

        dispatch(fetchExternalStatusPagesRequest());
        promise.then(
            function (response): void {
                dispatch(fetchExternalStatusPagesSuccess(response.data));
            },
            function (error): void {
                dispatch(fetchExternalStatusPagesFailure(error));
            }
        );
        return promise;
    };
}
export const translateLanguage = (payload: $TSFixMe): void => {
    return {
        type: types.TRANSLATE_LANGUAGE,
        payload,
    };
};
