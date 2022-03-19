import { getApi, postApi } from '../api';
import * as types from '../constants/status';
import errors from '../errors';
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

export const statusPageFailure = (error: $TSFixMe) => {
    return {
        type: types.STATUSPAGE_FAILURE,
        payload: error,
    };
};

// Calls the API to get status
export const getStatusPage = (statusPageSlug: $TSFixMe, url: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        const promise = getApi(`status-page/${statusPageSlug}?url=${url}`);

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
export const getAllStatusPageResource = (
    statusPageSlug: $TSFixMe,
    url: $TSFixMe,
    range: $TSFixMe
) => {
    return function (dispatch: $TSFixMe) {
        const promises = [];

        promises.push(
            getApi(
                `status-page/resources/${statusPageSlug}/ongoing-events?url=${url}&range=${range}`
            )
        );

        promises.push(
            getApi(
                `status-page/resources/${statusPageSlug}/future-events?url=${url}&range=${range}`
            )
        );

        promises.push(
            getApi(
                `status-page/resources/${statusPageSlug}/past-events?url=${url}&range=${range}`
            )
        );

        promises.push(
            getApi(
                `status-page/resources/${statusPageSlug}/probes?url=${url}&range=${range}`
            )
        );

        promises.push(
            getApi(
                `status-page/resources/${statusPageSlug}/monitor-logs?url=${url}&range=${range}`
            )
        );

        promises.push(
            getApi(
                `status-page/resources/${statusPageSlug}/announcements?url=${url}&range=${range}`
            )
        );

        promises.push(
            getApi(
                `status-page/resources/${statusPageSlug}/announcement-logs?url=${url}&range=${range}`
            )
        );

        promises.push(
            getApi(
                `status-page/resources/${statusPageSlug}/monitor-timelines?url=${url}&range=${range}`
            )
        );

        promises.push(
            getApi(
                `status-page/resources/${statusPageSlug}/statuspage-notes?url=${url}&range=${range}`
            )
        );

        promises.push(
            getApi(
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

                dispatch(statusPageFailure(errors(error)));
                dispatch(loginError(errors(error)));
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

export const statusPageNoteFailure = (error: $TSFixMe) => {
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
    projectId: $TSFixMe,
    statusPageSlug: $TSFixMe,
    skip: $TSFixMe,
    limit = 10,
    days = 14,
    newTheme = false
) => {
    return function (dispatch: $TSFixMe) {
        const promise = getApi(
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
                dispatch(statusPageNoteFailure(errors(error)));
            }
        );
    };
};

export const getStatusPageIndividualNote = (
    projectId: $TSFixMe,
    monitorId: $TSFixMe,
    date: $TSFixMe,
    name: $TSFixMe,
    need: $TSFixMe,
    theme: $TSFixMe
) => {
    return function (dispatch: $TSFixMe) {
        const promise = getApi(
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
                dispatch(statusPageNoteFailure(errors(error)));
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

export const scheduledEventFailure = (error: $TSFixMe) => {
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
    projectId: $TSFixMe,
    statusPageSlug: $TSFixMe,
    skip: $TSFixMe,
    theme: $TSFixMe,
    days: $TSFixMe
) => {
    return function (dispatch: $TSFixMe) {
        const promise = getApi(
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
                dispatch(scheduledEventFailure(errors(error)));
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

export const ongoingEventFailure = (error: $TSFixMe) => {
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
    projectId: $TSFixMe,
    statusPageSlug: $TSFixMe,
    skip: $TSFixMe,
    theme: $TSFixMe,
    limit: $TSFixMe
) => {
    return function (dispatch: $TSFixMe) {
        const promise = getApi(
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
                dispatch(ongoingEventFailure(errors(error)));
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

export const individualEventsFailure = (error: $TSFixMe) => ({
    type: types.INDIVIDUAL_EVENTS_FAILURE,
    payload: error,
});

export const getIndividualEvent = (
    projectId: $TSFixMe,
    monitorId: $TSFixMe,
    date: $TSFixMe,
    name: $TSFixMe,
    theme: $TSFixMe
) => {
    return function (dispatch: $TSFixMe) {
        const promise = getApi(
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
                dispatch(individualEventsFailure(errors(error)));
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

export const futureEventsFailure = (error: $TSFixMe) => ({
    type: types.FUTURE_EVENTS_FAILURE,
    payload: error,
});

export const fetchFutureEvents =
    (
        projectId: $TSFixMe,
        statusPageSlug: $TSFixMe,
        skip: $TSFixMe,
        theme: $TSFixMe,
        limit: $TSFixMe
    ) =>
    async (dispatch: $TSFixMe) => {
        try {
            dispatch(futureEventsRequest());
            const response = await getApi(
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

export const pastEventsFailure = (error: $TSFixMe) => ({
    type: types.PAST_EVENTS_FAILURE,
    payload: error,
});

export const fetchPastEvents =
    (
        projectId: $TSFixMe,
        statusPageSlug: $TSFixMe,
        skip: $TSFixMe,
        theme: $TSFixMe,
        limit: $TSFixMe
    ) =>
    async (dispatch: $TSFixMe) => {
        try {
            dispatch(pastEventsRequest());
            const response = await getApi(
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
    return function (dispatch: $TSFixMe) {
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

export const moreNoteFailure = (error: $TSFixMe) => {
    return {
        type: types.MORE_NOTES_FAILURE,
        payload: error,
    };
};

export const getMoreNote = (
    projectId: $TSFixMe,
    statusPageSlug: $TSFixMe,
    skip: $TSFixMe
) => {
    return function (dispatch: $TSFixMe) {
        const promise = getApi(
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
                dispatch(moreNoteFailure(errors(error)));
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

export const moreEventFailure = (error: $TSFixMe) => {
    return {
        type: types.MORE_EVENTS_FAILURE,
        payload: error,
    };
};

export const getMoreEvent = (
    projectId: $TSFixMe,
    statusPageSlug: $TSFixMe,
    skip: $TSFixMe
) => {
    return function (dispatch: $TSFixMe) {
        const promise = getApi(
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
                dispatch(moreEventFailure(errors(error)));
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

export const moreFutureEventsFailure = (error: $TSFixMe) => ({
    type: types.MORE_FUTURE_EVENTS_FAILURE,
    payload: error,
});

export const fetchMoreFutureEvents =
    (
        projectId: $TSFixMe,
        statusPageSlug: $TSFixMe,
        skip: $TSFixMe,
        limit: $TSFixMe
    ) =>
    async (dispatch: $TSFixMe) => {
        try {
            dispatch(moreFutureEventsRequest());
            const response = await getApi(
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

export const morePastEventsFailure = (error: $TSFixMe) => ({
    type: types.MORE_PAST_EVENTS_FAILURE,
    payload: error,
});

export const fetchMorePastEvents =
    (projectId: $TSFixMe, statusPageSlug: $TSFixMe, skip: $TSFixMe) =>
    async (dispatch: $TSFixMe) => {
        try {
            dispatch(morePastEventsRequest());
            const response = await getApi(
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

export function selectedProbe(val: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: types.SELECT_PROBE,
            payload: val,
        });
    };
}

// Fetch Monitor Statuses list
export function fetchMonitorStatuses(
    projectId: $TSFixMe,
    monitorId: $TSFixMe,
    startDate: $TSFixMe,
    endDate: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = postApi(
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
                dispatch(fetchMonitorStatusesFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function fetchMonitorStatusesRequest(id: $TSFixMe) {
    return {
        type: types.FETCH_MONITOR_STATUSES_REQUEST,
        payload: id,
    };
}

export function fetchMonitorStatusesSuccess(monitorStatuses: $TSFixMe) {
    return {
        type: types.FETCH_MONITOR_STATUSES_SUCCESS,
        payload: monitorStatuses,
    };
}

export function fetchMonitorStatusesFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_MONITOR_STATUSES_FAILURE,
        payload: error,
    };
}

export function fetchMonitorLogs(
    projectId: $TSFixMe,
    monitorId: $TSFixMe,
    data: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = postApi(
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
                dispatch(fetchMonitorLogsFailure(errors(error)));
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

function fetchMonitorLogsFailure(error: $TSFixMe) {
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

export function fetchEventSuccess(payload: $TSFixMe) {
    return {
        type: types.FETCH_EVENT_SUCCESS,
        payload,
    };
}

export function fetchEventFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_EVENT_FAILURE,
        payload: error,
    };
}

export function fetchEvent(projectId: $TSFixMe, scheduledEventId: $TSFixMe) {
    return async function (dispatch: $TSFixMe) {
        dispatch(fetchEventRequest());

        try {
            const response = await getApi(
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
}

// Handle scheduled event note
export function fetchEventNoteRequest() {
    return {
        type: types.FETCH_EVENT_NOTES_REQUEST,
    };
}

export function fetchEventNoteSuccess(payload: $TSFixMe) {
    return {
        type: types.FETCH_EVENT_NOTES_SUCCESS,
        payload,
    };
}

export function fetchEventNoteFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_EVENT_NOTES_FAILURE,
        payload: error,
    };
}

export function fetchEventNote(
    projectId: $TSFixMe,
    scheduledEventSlug: $TSFixMe,
    type: $TSFixMe
) {
    return async function (dispatch: $TSFixMe) {
        dispatch(fetchEventNoteRequest());

        try {
            const response = await getApi(
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

export function moreEventNoteRequest() {
    return {
        type: types.MORE_EVENT_NOTE_REQUEST,
    };
}

export function moreEventNoteSuccess(payload: $TSFixMe) {
    return {
        type: types.MORE_EVENT_NOTE_SUCCESS,
        payload,
    };
}

export function moreEventNoteFailure(error: $TSFixMe) {
    return {
        type: types.MORE_EVENT_NOTE_FAILURE,
        payload: error,
    };
}

export function moreEventNote(
    projectId: $TSFixMe,
    scheduledEventId: $TSFixMe,
    type: $TSFixMe,
    skip: $TSFixMe
) {
    return async function (dispatch: $TSFixMe) {
        try {
            dispatch(moreEventNoteRequest());

            const response = await getApi(
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
export function fetchIncidentRequest() {
    return {
        type: types.FETCH_INCIDENT_REQUEST,
    };
}

export function fetchIncidentSuccess(payload: $TSFixMe) {
    return {
        type: types.FETCH_INCIDENT_SUCCESS,
        payload,
    };
}

export function fetchIncidentFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_INCIDENT_FAILURE,
        payload: error,
    };
}

export function fetchIncident(projectId: $TSFixMe, incidentSlug: $TSFixMe) {
    return async function (dispatch: $TSFixMe) {
        try {
            dispatch(fetchIncidentRequest());
            const response = await getApi(
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
}

export function fetchIncidentNotesRequest() {
    return {
        type: types.FETCH_INCIDENT_NOTES_REQUEST,
    };
}

export function fetchIncidentNotesSuccess(payload: $TSFixMe) {
    return {
        type: types.FETCH_INCIDENT_NOTES_SUCCESS,
        payload,
    };
}

export function fetchIncidentNotesFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_INCIDENT_NOTES_FAILURE,
        payload: error,
    };
}

export function fetchIncidentNotes(
    projectId: $TSFixMe,
    incidentId: $TSFixMe,
    postOnStatusPage: $TSFixMe
) {
    return async function (dispatch: $TSFixMe) {
        try {
            dispatch(fetchIncidentNotesRequest());

            const response = await getApi(
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

export function moreIncidentNotesRequest() {
    return {
        type: types.MORE_INCIDENT_NOTES_REQUEST,
    };
}

export function moreIncidentNotesSuccess(payload: $TSFixMe) {
    return {
        type: types.MORE_INCIDENT_NOTES_SUCCESS,
        payload,
    };
}

export function moreIncidentNotesFailure(error: $TSFixMe) {
    return {
        type: types.MORE_INCIDENT_NOTES_FAILURE,
        payload: error,
    };
}

export function moreIncidentNotes(
    projectId: $TSFixMe,
    incidentSlug: $TSFixMe,
    postOnStatusPage: $TSFixMe,
    skip: $TSFixMe
) {
    return async function (dispatch: $TSFixMe) {
        try {
            dispatch(moreIncidentNotesRequest());

            const response = await getApi(
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

export function fetchLastIncidentTimelineRequest() {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINE_REQUEST,
    };
}

export function fetchLastIncidentTimelineSuccess(payload: $TSFixMe) {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINE_SUCCESS,
        payload,
    };
}

export function fetchLastIncidentTimelineFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINE_FAILURE,
        payload: error,
    };
}

export function fetchLastIncidentTimeline(
    projectId: $TSFixMe,
    incidentSlug: $TSFixMe
) {
    return async function (dispatch: $TSFixMe) {
        try {
            dispatch(fetchLastIncidentTimelineRequest());

            const response = await getApi(
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

export function fetchLastIncidentTimelinesRequest() {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINES_REQUEST,
    };
}

export function fetchLastIncidentTimelinesSuccess(payload: $TSFixMe) {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINES_SUCCESS,
        payload,
    };
}

export function fetchLastIncidentTimelinesFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINES_FAILURE,
        payload: error,
    };
}

export function fetchLastIncidentTimelines(
    projectId: $TSFixMe,
    statusPageSlug: $TSFixMe
) {
    return async function (dispatch: $TSFixMe) {
        try {
            dispatch(fetchLastIncidentTimelinesRequest());

            const response = await getApi(
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

export function showEventCard(payload: $TSFixMe) {
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

export function getAnnouncementsSuccess(data: $TSFixMe) {
    return {
        type: types.FETCH_ANNOUNCEMENTS_SUCCESS,
        payload: data,
    };
}

export function getAnnouncementsFailure(data: $TSFixMe) {
    return {
        type: types.FETCH_ANNOUNCEMENTS_FAILURE,
        payload: data,
    };
}

export function getAnnouncements(
    projectId: $TSFixMe,
    statusPageId: $TSFixMe,
    skip = 0,
    limit: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = getApi(
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

export function getSingleAnnouncementSuccess(data: $TSFixMe) {
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

export function getSingleAnnouncementFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_SINGLE_ANNOUNCEMENTS_FAILURE,
        payload: error,
    };
}

export function getSingleAnnouncement(
    projectId: $TSFixMe,
    statusPageSlug: $TSFixMe,
    announcementSlug: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = getApi(
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

export function fetchAnnouncementLogsRequest() {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_REQUEST,
    };
}

export function fetchAnnouncementLogsSuccess(data: $TSFixMe) {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_SUCCESS,
        payload: data,
    };
}

export function fetchAnnouncementLogsFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_FAILURE,
        payload: error,
    };
}

export function fetchAnnouncementLogs(
    projectId: $TSFixMe,
    statusPageId: $TSFixMe,
    skip = 0,
    limit: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = getApi(
            `status-page/${projectId}/announcementLogs/${statusPageId}?skip=${skip}&limit=${limit}&theme=${true}`
        );
        dispatch(fetchAnnouncementLogsRequest());
        promise.then(
            function (response) {
                dispatch(fetchAnnouncementLogsSuccess(response.data));
            },
            function (error) {
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

export function calculateTimeRequest(monitorId: $TSFixMe) {
    return {
        type: types.CALCULATE_TIME_REQUEST,
        payload: monitorId,
    };
}

export function calculateTimeSuccess(payload: $TSFixMe) {
    return {
        type: types.CALCULATE_TIME_SUCCESS,
        payload,
    };
}

export function calculateTimeFailure(error: $TSFixMe) {
    return {
        type: types.CALCULATE_TIME_FAILURE,
        payload: error,
    };
}

export function calculateTime(
    statuses: $TSFixMe,
    start: $TSFixMe,
    range: $TSFixMe,
    monitorId: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = postApi(`monitor/${monitorId}/calculate-time`, {
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

export function fetchTweetsRequest(monitorId: $TSFixMe) {
    return {
        type: types.FETCH_TWEETS_REQUEST,
        payload: monitorId,
    };
}

export function fetchTweetsSuccess(payload: $TSFixMe) {
    return {
        type: types.FETCH_TWEETS_SUCCESS,
        payload,
    };
}

export function fetchTweetsFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_TWEETS_FAILURE,
        payload: error,
    };
}

export function fetchTweets(handle: $TSFixMe, projectId: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        const promise = postApi(`status-page/${projectId}/tweets`, {
            handle,
        });

        dispatch(fetchTweetsRequest());
        promise.then(
            function (response) {
                dispatch(fetchTweetsSuccess(response.data));
            },
            function (error) {
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

export function fetchExternalStatusPagesSuccess(payload: $TSFixMe) {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_SUCCESS,
        payload,
    };
}

export function fetchExternalStatusPagesFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_FAILURE,
        payload: error,
    };
}

export function fetchExternalStatusPages(
    projectId: $TSFixMe,
    statusPageId: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = getApi(
            `status-page/${projectId}/fetchExternalStatusPages/${statusPageId}`
        );

        dispatch(fetchExternalStatusPagesRequest());
        promise.then(
            function (response) {
                dispatch(fetchExternalStatusPagesSuccess(response.data));
            },
            function (error) {
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
export function translateLanguage(payload: $TSFixMe) {
    return {
        type: types.TRANSLATE_LANGUAGE,
        payload,
    };
}
