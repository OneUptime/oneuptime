import {
    FETCH_SCHEDULED_EVENTS_SUCCESS,
    FETCH_SCHEDULED_EVENTS_REQUEST,
    FETCH_SCHEDULED_EVENTS_FAILURE,
    CREATE_SCHEDULED_EVENT_SUCCESS,
    CREATE_SCHEDULED_EVENT_REQUEST,
    CREATE_SCHEDULED_EVENT_FAILURE,
    DELETE_SCHEDULED_EVENT_SUCCESS,
    DELETE_SCHEDULED_EVENT_REQUEST,
    DELETE_SCHEDULED_EVENT_FAILURE,
    CANCEL_SCHEDULED_EVENT_SUCCESS,
    CANCEL_SCHEDULED_EVENT_REQUEST,
    CANCEL_SCHEDULED_EVENT_FAILURE,
    UPDATE_SCHEDULED_EVENT_SUCCESS,
    UPDATE_SCHEDULED_EVENT_REQUEST,
    UPDATE_SCHEDULED_EVENT_FAILURE,
    FETCH_SCHEDULED_EVENT_SUCCESS,
    FETCH_SCHEDULED_EVENT_REQUEST,
    FETCH_SCHEDULED_EVENT_FAILURE,
    CREATE_SCHEDULED_EVENT_NOTE_REQUEST,
    CREATE_SCHEDULED_EVENT_NOTE_SUCCESS,
    CREATE_SCHEDULED_EVENT_NOTE_FAILURE,
    FETCH_SCHEDULED_EVENT_NOTES_INVESTIGATION_REQUEST,
    FETCH_SCHEDULED_EVENT_NOTES_INVESTIGATION_SUCCESS,
    FETCH_SCHEDULED_EVENT_NOTES_INVESTIGATION_FAILURE,
    FETCH_SCHEDULED_EVENT_NOTES_INTERNAL_REQUEST,
    FETCH_SCHEDULED_EVENT_NOTES_INTERNAL_SUCCESS,
    FETCH_SCHEDULED_EVENT_NOTES_INTERNAL_FAILURE,
    UPDATE_SCHEDULED_EVENT_NOTE_INVESTIGATION_REQUEST,
    UPDATE_SCHEDULED_EVENT_NOTE_INVESTIGATION_SUCCESS,
    UPDATE_SCHEDULED_EVENT_NOTE_INVESTIGATION_FAILURE,
    UPDATE_SCHEDULED_EVENT_NOTE_INTERNAL_REQUEST,
    UPDATE_SCHEDULED_EVENT_NOTE_INTERNAL_SUCCESS,
    UPDATE_SCHEDULED_EVENT_NOTE_INTERNAL_FAILURE,
    DELETE_SCHEDULED_EVENT_NOTE_REQUEST,
    DELETE_SCHEDULED_EVENT_NOTE_SUCCESS,
    DELETE_SCHEDULED_EVENT_NOTE_FAILURE,
    FETCH_ONGOING_SCHEDULED_EVENTS_FAILURE,
    FETCH_ONGOING_SCHEDULED_EVENTS_REQUEST,
    FETCH_ONGOING_SCHEDULED_EVENTS_SUCCESS,
    FETCH_SUBPROJECT_SCHEDULED_EVENTS_FAILURE,
    FETCH_SUBPROJECT_SCHEDULED_EVENTS_REQUEST,
    FETCH_SUBPROJECT_SCHEDULED_EVENTS_SUCCESS,
    FETCH_SUBPROJECT_ONGOING_SCHEDULED_EVENTS_FAILURE,
    FETCH_SUBPROJECT_ONGOING_SCHEDULED_EVENTS_REQUEST,
    FETCH_SUBPROJECT_ONGOING_SCHEDULED_EVENTS_SUCCESS,
    RESOLVE_SCHEDULED_EVENT_FAILURE,
    RESOLVE_SCHEDULED_EVENT_REQUEST,
    RESOLVE_SCHEDULED_EVENT_SUCCESS,
    NEXT_PAGE,
    PREV_PAGE,
    FETCH_SCHEDULED_EVENT_REQUEST_SLUG,
    FETCH_SCHEDULED_EVENT_SUCCESS_SLUG,
    FETCH_SCHEDULED_EVENT_FAILURE_SLUG,
    ADD_SCHEDULE_EVENT,
} from '../constants/scheduledEvent';
import moment from 'moment';

const INITIAL_STATE = {
    scheduledEventList: {
        scheduledEvents: [],
        error: null,
        requesting: false,
        success: false,
        skip: null,
        limit: null,
        count: null,
    },
    currentScheduledEvent: {
        requesting: false,
        error: null,
        success: false,
        scheduledEvent: null,
    },
    subProjectScheduledEventList: {
        requesting: false,
        success: false,
        error: null,
        scheduledEvents: [],
    },
    newScheduledEvent: {
        scheduledEvent: null,
        error: null,
        requesting: false,
        success: false,
    },
    deletedScheduledEvent: {
        error: null,
        requesting: false,
        success: false,
    },
    updatedScheduledEvent: {
        scheduledEvent: null,
        error: null,
        requesting: false,
        success: false,
    },
    cancelScheduledEvent: {
        scheduledEvent: null,
        error: null,
        requesting: false,
        success: false,
    },
    scheduledEventInvestigationList: {
        error: null,
        requesting: false,
        success: false,
        skip: null,
        limit: null,
        count: null,
        scheduledEventNotes: [],
    },
    scheduledEventInternalList: {
        error: null,
        requesting: false,
        success: false,
        skip: null,
        limit: null,
        count: null,
        scheduledEventNotes: [],
    },
    newScheduledEventNote: {
        scheduledEventNote: null,
        requesting: false,
        success: false,
        error: null,
    },
    updateScheduledEventNoteInternal: {
        requesting: false,
        success: false,
        error: null,
        scheduledEventNote: null,
    },
    updateScheduledEventNoteInvestigation: {
        requesting: false,
        success: false,
        error: null,
        scheduledEventNote: null,
    },
    deleteScheduledEventNote: {
        requesting: false,
        success: false,
        error: null,
    },
    ongoingScheduledEvent: {
        requesting: false,
        success: false,
        error: null,
        events: [],
        count: 0,
    },
    subProjectOngoingScheduledEvent: {
        requesting: false,
        success: false,
        error: null,
        events: [],
    },
    resolveScheduledEvent: {
        requesting: false,
        success: false,
        error: null,
    },
    pages: {},
};

export default function scheduledEvent(
    state = INITIAL_STATE,
    action: $TSFixMe
) {
    switch (action.type) {
        case CREATE_SCHEDULED_EVENT_SUCCESS: {
            let existingPayload = false;
            let existingOngoingEvent = false;
            const currentDate = moment().format();
            const startDate = moment(action.payload.startDate).format();
            const endDate = moment(action.payload.endDate).format();
            state.scheduledEventList.scheduledEvents.map(event => {
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                if (String(event._id) === String(action.payload._id)) {
                    existingPayload = true;
                }
                return event;
            });

            const eventPayload = existingPayload ? [] : [action.payload];

            let events = [...state.subProjectOngoingScheduledEvent.events];

            state.subProjectOngoingScheduledEvent.events.forEach(eventData => {
                if (
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'never'.
                    String(eventData.project) ===
                    String(action.payload.projectId._id)
                ) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'ongoingScheduledEvents' does not exist o... Remove this comment to see the full error message
                    eventData.ongoingScheduledEvents.forEach(
                        (event: $TSFixMe) => {
                            if (
                                String(event._id) === String(action.payload._id)
                            ) {
                                existingOngoingEvent = true;
                            }
                        }
                    );
                }
            });

            if (!existingOngoingEvent) {
                if (startDate <= currentDate && endDate > currentDate) {
                    events = state.subProjectOngoingScheduledEvent.events.map(
                        eventData => {
                            if (
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'never'.
                                String(eventData.project) ===
                                String(action.payload.projectId._id)
                            ) {
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'ongoingScheduledEvents' does not exist o... Remove this comment to see the full error message
                                eventData.ongoingScheduledEvents = [
                                    action.payload,
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'ongoingScheduledEvents' does not exist o... Remove this comment to see the full error message
                                    ...eventData.ongoingScheduledEvents,
                                ];
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'never'.
                                eventData.count =
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'ongoingScheduledEvents' does not exist o... Remove this comment to see the full error message
                                    eventData.ongoingScheduledEvents.length;
                            }
                            return eventData;
                        }
                    );
                }
            }

            const scheduledEvents = state.subProjectScheduledEventList.scheduledEvents.map(
                event => {
                    if (
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'never'.
                        String(event.project) ===
                        String(action.payload.projectId._id)
                    ) {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduledEvents' does not exist on type ... Remove this comment to see the full error message
                        const existingEvent = event.scheduledEvents.find(
                            (event: $TSFixMe) =>
                                String(event._id) === String(action.payload._id)
                        );
                        if (!existingEvent) {
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduledEvents' does not exist on type ... Remove this comment to see the full error message
                            event.scheduledEvents = [
                                action.payload,
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduledEvents' does not exist on type ... Remove this comment to see the full error message
                                ...event.scheduledEvents,
                            ];
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'never'.
                            event.count = event.count + 1;
                        }
                    }
                    return event;
                }
            );

            return Object.assign({}, state, {
                currentScheduledEvent: {
                    requesting: false,
                    error: null,
                    success: true,
                    scheduledEvent: action.payload,
                },
                pages: {
                    ...state.pages,
                    [action.payload.projectId._id]: 1,
                },
                scheduledEventList: {
                    ...state.scheduledEventList,
                    scheduledEvents: [
                        ...eventPayload,
                        ...state.scheduledEventList.scheduledEvents,
                    ],
                    // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                    count: state.scheduledEventList.count + 1,
                },
                subProjectScheduledEventList: {
                    ...state.subProjectScheduledEventList,
                    scheduledEvents,
                },
                subProjectOngoingScheduledEvent: {
                    ...state.subProjectOngoingScheduledEvent,
                    events,
                },
            });
        }
        case CREATE_SCHEDULED_EVENT_FAILURE:
            return Object.assign({}, state, {
                ...state,
                currentScheduledEvent: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    scheduledEvent: state.currentScheduledEvent.scheduledEvent,
                },
            });
        case NEXT_PAGE:
            return Object.assign({}, state, {
                pages: {
                    ...state.pages,
                    // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                    [action.payload]: !state.pages[action.payload]
                        ? 2
                        : // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                          state.pages[action.payload] + 1,
                },
            });
        case PREV_PAGE:
            return Object.assign({}, state, {
                pages: {
                    ...state.pages,
                    // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                    [action.payload]: state.pages[action.payload] - 1,
                },
            });
        case CREATE_SCHEDULED_EVENT_REQUEST:
            return Object.assign({}, state, {
                ...state,
                currentScheduledEvent: {
                    requesting: true,
                    error: null,
                    success: false,
                    scheduledEvent: state.currentScheduledEvent.scheduledEvent,
                },
            });

        case FETCH_SCHEDULED_EVENTS_SUCCESS: {
            const scheduledEvents = state.subProjectScheduledEventList.scheduledEvents.map(
                event => {
                    if (
                        action.payload.data.length > 0 &&
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'never'.
                        String(event.project) ===
                            String(action.payload.data[0].projectId._id)
                    ) {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduledEvents' does not exist on type ... Remove this comment to see the full error message
                        event.scheduledEvents = action.payload.data;
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'skip' does not exist on type 'never'.
                        event.skip = action.payload.skip;
                    }

                    return event;
                }
            );
            return Object.assign({}, state, {
                ...state,
                scheduledEventList: {
                    requesting: false,
                    error: null,
                    success: true,
                    scheduledEvents: action.payload.data,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip,
                },
                subProjectScheduledEventList: {
                    ...state.subProjectScheduledEventList,
                    scheduledEvents,
                },
            });
        }
        case FETCH_SCHEDULED_EVENTS_FAILURE:
            return Object.assign({}, state, {
                ...state,
                scheduledEventList: {
                    ...state.scheduledEventList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case FETCH_SCHEDULED_EVENTS_REQUEST:
            return Object.assign({}, state, {
                ...state,
                scheduledEventList: {
                    ...state.scheduledEventList,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case FETCH_SUBPROJECT_SCHEDULED_EVENTS_REQUEST:
            return {
                ...state,
                subProjectScheduledEventList: {
                    ...state.subProjectScheduledEventList,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case FETCH_SUBPROJECT_SCHEDULED_EVENTS_SUCCESS:
            return {
                ...state,
                subProjectScheduledEventList: {
                    requesting: false,
                    success: true,
                    error: null,
                    scheduledEvents: action.payload,
                },
            };

        case FETCH_SUBPROJECT_SCHEDULED_EVENTS_FAILURE:
            return {
                ...state,
                subProjectScheduledEventList: {
                    ...state.subProjectScheduledEventList,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case FETCH_ONGOING_SCHEDULED_EVENTS_REQUEST:
            return {
                ...state,
                ongoingScheduledEvent: {
                    ...state.ongoingScheduledEvent,
                    requesting: true,
                    error: null,
                    success: false,
                },
            };

        case FETCH_ONGOING_SCHEDULED_EVENTS_SUCCESS:
            return {
                ...state,
                ongoingScheduledEvent: {
                    requesting: false,
                    success: true,
                    error: null,
                    events: action.payload.data,
                    count: action.payload.count,
                },
            };

        case FETCH_ONGOING_SCHEDULED_EVENTS_FAILURE:
            return {
                ...state,
                ongoingScheduledEvent: {
                    ...state.ongoingScheduledEvent,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case FETCH_SUBPROJECT_ONGOING_SCHEDULED_EVENTS_REQUEST:
            return {
                ...state,
                subProjectOngoingScheduledEvent: {
                    ...state.subProjectOngoingScheduledEvent,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case FETCH_SUBPROJECT_ONGOING_SCHEDULED_EVENTS_SUCCESS:
            return {
                ...state,
                subProjectOngoingScheduledEvent: {
                    requesting: false,
                    success: true,
                    error: null,
                    events: action.payload,
                },
            };

        case FETCH_SUBPROJECT_ONGOING_SCHEDULED_EVENTS_FAILURE:
            return {
                ...state,
                subProjectOngoingScheduledEvent: {
                    ...state.subProjectOngoingScheduledEvent,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case FETCH_SCHEDULED_EVENT_SUCCESS:
            return {
                ...state,
                currentScheduledEvent: {
                    requesting: false,
                    error: null,
                    success: true,
                    scheduledEvent: action.payload,
                },
            };
        case ADD_SCHEDULE_EVENT:
            return {
                ...state,
                currentScheduledEvent: {
                    ...state.currentScheduledEvent,
                    scheduledEvent: action.payload,
                },
            };
        case FETCH_SCHEDULED_EVENT_REQUEST:
            return {
                ...state,
                currentScheduledEvent: {
                    ...state.currentScheduledEvent,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case FETCH_SCHEDULED_EVENT_FAILURE:
            return {
                ...state,
                currentScheduledEvent: {
                    ...state.currentScheduledEvent,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case DELETE_SCHEDULED_EVENT_SUCCESS: {
            let deleted = true;

            const scheduledEvents = state.subProjectScheduledEventList.scheduledEvents.map(
                subEvent => {
                    if (
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'never'.
                        String(subEvent.project) ===
                        String(action.payload.projectId)
                    ) {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduledEvents' does not exist on type ... Remove this comment to see the full error message
                        subEvent.scheduledEvents = subEvent.scheduledEvents.filter(
                            (event: $TSFixMe) => {
                                if (
                                    String(event._id) ===
                                    String(action.payload._id)
                                ) {
                                    deleted = false;
                                }

                                return (
                                    String(event._id) !==
                                    String(action.payload._id)
                                );
                            }
                        );
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'never'.
                        subEvent.count = deleted
                            ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'never'.
                              subEvent.count
                            : // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'never'.
                              subEvent.count - 1;
                    }
                    return subEvent;
                }
            );

            const events = state.subProjectOngoingScheduledEvent.events.map(
                eventData => {
                    if (
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'never'.
                        String(eventData.project) ===
                        String(action.payload.projectId)
                    ) {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'ongoingScheduledEvents' does not exist o... Remove this comment to see the full error message
                        eventData.ongoingScheduledEvents = eventData.ongoingScheduledEvents.filter(
                            (event: $TSFixMe) =>
                                String(event._id) !== String(action.payload._id)
                        );
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'never'.
                        eventData.count =
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'ongoingScheduledEvents' does not exist o... Remove this comment to see the full error message
                            eventData.ongoingScheduledEvents.length;
                    }
                    return eventData;
                }
            );

            return Object.assign({}, state, {
                ...state,
                scheduledEventList: {
                    ...state.scheduledEventList,
                    scheduledEvents: state.scheduledEventList.scheduledEvents.filter(
                        scheduledEvent => {
                            if (
                                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                                String(scheduledEvent._id) ===
                                String(action.payload._id)
                            ) {
                                deleted = false;
                            }
                            return (
                                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                                String(scheduledEvent._id) !==
                                String(action.payload._id)
                            );
                        }
                    ),
                    count: deleted
                        ? state.scheduledEventList.count
                        : // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                          state.scheduledEventList.count - 1,
                },
                deletedScheduledEvent: {
                    requesting: false,
                    success: true,
                    error: false,
                },
                subProjectScheduledEventList: {
                    ...state.subProjectScheduledEventList,
                    scheduledEvents,
                },
                subProjectOngoingScheduledEvent: {
                    ...state.subProjectOngoingScheduledEvent,
                    events,
                },
            });
        }

        case DELETE_SCHEDULED_EVENT_FAILURE:
            return Object.assign({}, state, {
                ...state,
                deletedScheduledEvent: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case DELETE_SCHEDULED_EVENT_REQUEST:
            return Object.assign({}, state, {
                ...state,
                deletedScheduledEvent: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });

        case CANCEL_SCHEDULED_EVENT_SUCCESS: {
            const currentDate = moment().format();
            const startDate = moment(action.payload.startDate).format();
            const endDate = moment(action.payload.endDate).format();
            const scheduledEvents = state.scheduledEventList.scheduledEvents.map(
                scheduledEvent => {
                    if (
                        String(action.payload._id) ===
                        // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                        String(scheduledEvent._id)
                    ) {
                        return action.payload;
                    }
                    return scheduledEvent;
                }
            );
            const subEvents = state.subProjectScheduledEventList.scheduledEvents.map(
                subEvent => {
                    if (
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'never'.
                        String(subEvent.project) ===
                        String(action.payload.projectId._id)
                    ) {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduledEvents' does not exist on type ... Remove this comment to see the full error message
                        subEvent.scheduledEvents = subEvent.scheduledEvents.map(
                            (event: $TSFixMe) => {
                                if (
                                    String(event._id) ===
                                    String(action.payload._id)
                                ) {
                                    event = action.payload;
                                }
                                return event;
                            }
                        );
                    }
                    return subEvent;
                }
            );

            const events = state.subProjectOngoingScheduledEvent.events.map(
                eventData => {
                    if (
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'never'.
                        String(eventData.project) ===
                        String(action.payload.projectId._id)
                    ) {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'ongoingScheduledEvents' does not exist o... Remove this comment to see the full error message
                        eventData.ongoingScheduledEvents = eventData.ongoingScheduledEvents.filter(
                            (event: $TSFixMe) => {
                                return (
                                    String(event._id) !==
                                    String(action.payload._id)
                                );
                            }
                        );
                        if (startDate <= currentDate && endDate > currentDate) {
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'ongoingScheduledEvents' does not exist o... Remove this comment to see the full error message
                            eventData.ongoingScheduledEvents = [
                                action.payload,
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'ongoingScheduledEvents' does not exist o... Remove this comment to see the full error message
                                ...eventData.ongoingScheduledEvents,
                            ];
                        }
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'never'.
                        eventData.count =
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'ongoingScheduledEvents' does not exist o... Remove this comment to see the full error message
                            eventData.ongoingScheduledEvents.length;
                    }

                    return eventData;
                }
            );

            return Object.assign({}, state, {
                cancelScheduledEvent: {
                    scheduledEvent: action.payload,
                    requesting: false,
                    success: true,
                    error: false,
                },

                newScheduledEvent: {
                    requesting: false,
                    error: null,
                    success: true,
                    scheduledEvent: action.payload,
                },
                scheduledEventList: {
                    ...state.scheduledEventList,
                    scheduledEvents,
                },
                subProjectScheduledEventList: {
                    ...state.subProjectScheduledEventList,
                    scheduledEvents: subEvents,
                },
                subProjectOngoingScheduledEvent: {
                    ...state.subProjectOngoingScheduledEvent,
                    events,
                },
            });
        }

        case CANCEL_SCHEDULED_EVENT_FAILURE:
            return Object.assign({}, state, {
                ...state,
                cancelScheduledEvent: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case CANCEL_SCHEDULED_EVENT_REQUEST:
            return Object.assign({}, state, {
                ...state,
                cancelScheduledEvent: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            });

        case UPDATE_SCHEDULED_EVENT_SUCCESS: {
            const currentDate = moment().format();
            const startDate = moment(action.payload.startDate).format();
            const endDate = moment(action.payload.endDate).format();
            const scheduledEvents = state.scheduledEventList.scheduledEvents.map(
                scheduledEvent => {
                    if (
                        String(action.payload._id) ===
                        // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                        String(scheduledEvent._id)
                    ) {
                        return action.payload;
                    }
                    return scheduledEvent;
                }
            );
            const subEvents = state.subProjectScheduledEventList.scheduledEvents.map(
                subEvent => {
                    if (
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'never'.
                        String(subEvent.project) ===
                        String(action.payload.projectId._id)
                    ) {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduledEvents' does not exist on type ... Remove this comment to see the full error message
                        subEvent.scheduledEvents = subEvent.scheduledEvents.map(
                            (event: $TSFixMe) => {
                                if (
                                    String(event._id) ===
                                    String(action.payload._id)
                                ) {
                                    event = action.payload;
                                }
                                return event;
                            }
                        );
                    }
                    return subEvent;
                }
            );

            const events = state.subProjectOngoingScheduledEvent.events.map(
                eventData => {
                    if (
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'never'.
                        String(eventData.project) ===
                        String(action.payload.projectId._id)
                    ) {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'ongoingScheduledEvents' does not exist o... Remove this comment to see the full error message
                        eventData.ongoingScheduledEvents = eventData.ongoingScheduledEvents.filter(
                            (event: $TSFixMe) => {
                                return (
                                    String(event._id) !==
                                    String(action.payload._id)
                                );
                            }
                        );
                        if (startDate <= currentDate && endDate > currentDate) {
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'ongoingScheduledEvents' does not exist o... Remove this comment to see the full error message
                            eventData.ongoingScheduledEvents = [
                                action.payload,
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'ongoingScheduledEvents' does not exist o... Remove this comment to see the full error message
                                ...eventData.ongoingScheduledEvents,
                            ];
                        }
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'never'.
                        eventData.count =
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'ongoingScheduledEvents' does not exist o... Remove this comment to see the full error message
                            eventData.ongoingScheduledEvents.length;
                    }

                    return eventData;
                }
            );

            return Object.assign({}, state, {
                updatedScheduledEvent: {
                    requesting: false,
                    error: null,
                    success: true,
                    scheduledEvent: action.payload,
                },
                currentScheduledEvent: {
                    requesting: false,
                    error: null,
                    success: true,
                    scheduledEvent: action.payload,
                },
                scheduledEventList: {
                    ...state.scheduledEventList,
                    scheduledEvents,
                },
                subProjectScheduledEventList: {
                    ...state.subProjectScheduledEventList,
                    scheduledEvents: subEvents,
                },
                subProjectOngoingScheduledEvent: {
                    ...state.subProjectOngoingScheduledEvent,
                    events,
                },
            });
        }

        case UPDATE_SCHEDULED_EVENT_FAILURE:
            return Object.assign({}, state, {
                ...state,
                updatedScheduledEvent: {
                    ...state.updatedScheduledEvent,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case UPDATE_SCHEDULED_EVENT_REQUEST:
            return Object.assign({}, state, {
                ...state,
                updatedScheduledEvent: {
                    ...state.updatedScheduledEvent,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case CREATE_SCHEDULED_EVENT_NOTE_REQUEST:
            return {
                ...state,
                newScheduledEventNote: {
                    ...state.newScheduledEventNote,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case CREATE_SCHEDULED_EVENT_NOTE_SUCCESS: {
            let scheduledEventInternalList = {
                ...state.scheduledEventInternalList,
            };

            let existingPayload = false;
            scheduledEventInternalList.scheduledEventNotes.map(note => {
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                if (String(note._id) === String(action.payload._id)) {
                    existingPayload = true;
                }
                return note;
            });
            const notePayload = existingPayload ? [] : [action.payload];
            scheduledEventInternalList = {
                ...scheduledEventInternalList,
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'any[]' is not assignable to type 'never[]'.
                scheduledEventNotes: [
                    ...notePayload,
                    ...scheduledEventInternalList.scheduledEventNotes,
                ],
                count: existingPayload
                    ? scheduledEventInternalList.count
                    : // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                      scheduledEventInternalList.count + 1,
            };

            return {
                ...state,
                newScheduledEventNote: {
                    requesting: false,
                    success: true,
                    error: null,
                    scheduledEventNotes: action.payload,
                },
                scheduledEventInternalList,
            };
        }

        case CREATE_SCHEDULED_EVENT_NOTE_FAILURE:
            return {
                ...state,
                newScheduledEventNote: {
                    ...state.newScheduledEventNote,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case UPDATE_SCHEDULED_EVENT_NOTE_INVESTIGATION_REQUEST:
            return {
                ...state,
                updateScheduledEventNoteInvestigation: {
                    ...state.updateScheduledEventNoteInvestigation,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case UPDATE_SCHEDULED_EVENT_NOTE_INVESTIGATION_SUCCESS: {
            const scheduledEventNotes = state.scheduledEventInvestigationList.scheduledEventNotes.map(
                investigationNote => {
                    if (
                        // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                        String(investigationNote._id) ===
                        String(action.payload._id)
                    ) {
                        return action.payload;
                    }

                    return investigationNote;
                }
            );

            return {
                ...state,
                updateScheduledEventNoteInvestigation: {
                    requesting: false,
                    success: true,
                    error: null,
                    scheduledEventNote: action.payload,
                },
                scheduledEventInvestigationList: {
                    ...state.scheduledEventInvestigationList,
                    scheduledEventNotes,
                },
            };
        }

        case UPDATE_SCHEDULED_EVENT_NOTE_INVESTIGATION_FAILURE:
            return {
                ...state,
                updateScheduledEventNoteInvestigation: {
                    ...state.updateScheduledEventNoteInvestigation,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case UPDATE_SCHEDULED_EVENT_NOTE_INTERNAL_REQUEST:
            return {
                ...state,
                updateScheduledEventNoteInternal: {
                    ...state.updateScheduledEventNoteInternal,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case UPDATE_SCHEDULED_EVENT_NOTE_INTERNAL_SUCCESS: {
            const scheduledEventNotes = state.scheduledEventInternalList.scheduledEventNotes.map(
                internalNote => {
                    if (
                        // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                        String(internalNote._id) === String(action.payload._id)
                    ) {
                        return action.payload;
                    }

                    return internalNote;
                }
            );
            return {
                ...state,
                updateScheduledEventNoteInternal: {
                    requesting: false,
                    success: true,
                    error: null,
                    scheduledEventNote: action.payload,
                },
                scheduledEventInternalList: {
                    ...state.scheduledEventInternalList,
                    scheduledEventNotes,
                },
            };
        }

        case UPDATE_SCHEDULED_EVENT_NOTE_INTERNAL_FAILURE:
            return {
                ...state,
                updateScheduledEventNoteInternal: {
                    ...state.updateScheduledEventNoteInternal,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case DELETE_SCHEDULED_EVENT_NOTE_REQUEST:
            return {
                ...state,
                deleteScheduledEventNote: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case DELETE_SCHEDULED_EVENT_NOTE_SUCCESS: {
            const scheduledEventNotes = state.scheduledEventInternalList.scheduledEventNotes.map(
                internalNote => {
                    if (
                        // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                        String(internalNote._id) === String(action.payload._id)
                    ) {
                        return action.payload;
                    }

                    return internalNote;
                }
            );

            return {
                ...state,
                deleteScheduledEventNote: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                scheduledEventInternalList: {
                    ...state.scheduledEventInternalList,
                    scheduledEventNotes,
                },
            };
        }

        case DELETE_SCHEDULED_EVENT_NOTE_FAILURE:
            return {
                ...state,
                deleteScheduledEventNote: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case FETCH_SCHEDULED_EVENT_NOTES_INVESTIGATION_REQUEST:
            return {
                ...state,
                scheduledEventInvestigationList: {
                    ...state.scheduledEventInvestigationList,
                    error: null,
                    requesting: true,
                    success: false,
                },
            };

        case FETCH_SCHEDULED_EVENT_NOTES_INVESTIGATION_SUCCESS:
            return {
                ...state,
                scheduledEventInvestigationList: {
                    error: null,
                    requesting: false,
                    success: true,
                    skip: action.payload.skip,
                    limit: action.payload.limit,
                    count: action.payload.count,
                    scheduledEventNotes: action.payload.data,
                },
            };

        case FETCH_SCHEDULED_EVENT_NOTES_INVESTIGATION_FAILURE:
            return {
                ...state,
                scheduledEventInvestigationList: {
                    ...state.scheduledEventInvestigationList,
                    error: action.payload,
                    requesting: false,
                    success: false,
                },
            };

        case FETCH_SCHEDULED_EVENT_NOTES_INTERNAL_REQUEST:
            return {
                ...state,
                scheduledEventInternalList: {
                    ...state.scheduledEventInternalList,
                    error: null,
                    requesting: true,
                    success: false,
                },
            };

        case FETCH_SCHEDULED_EVENT_NOTES_INTERNAL_SUCCESS:
            return {
                ...state,
                scheduledEventInternalList: {
                    error: null,
                    requesting: false,
                    success: true,
                    skip: action.payload.skip,
                    limit: action.payload.limit,
                    count: action.payload.count,
                    scheduledEventNotes: action.payload.data,
                },
            };

        case FETCH_SCHEDULED_EVENT_NOTES_INTERNAL_FAILURE:
            return {
                ...state,
                scheduledEventInternalList: {
                    ...state.scheduledEventInternalList,
                    error: action.payload,
                    requesting: false,
                    success: false,
                },
            };

        case RESOLVE_SCHEDULED_EVENT_REQUEST:
            return {
                ...state,
                resolveScheduledEvent: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case RESOLVE_SCHEDULED_EVENT_SUCCESS: {
            const events = state.subProjectOngoingScheduledEvent.events.map(
                event => {
                    if (
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'never'.
                        String(event.project) ===
                        String(action.payload.projectId._id)
                    ) {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'ongoingScheduledEvents' does not exist o... Remove this comment to see the full error message
                        event.ongoingScheduledEvents = event.ongoingScheduledEvents.filter(
                            (ongoingEvent: $TSFixMe) =>
                                String(ongoingEvent._id) !==
                                String(action.payload._id)
                        );
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'never'.
                        event.count = event.ongoingScheduledEvents.length;
                    }
                    return event;
                }
            );
            return {
                ...state,
                resolveScheduledEvent: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                currentScheduledEvent: {
                    ...state.currentScheduledEvent,
                    scheduledEvent: action.payload,
                },
                subProjectOngoingScheduledEvent: {
                    ...state.subProjectOngoingScheduledEvent,
                    events,
                },
            };
        }

        case RESOLVE_SCHEDULED_EVENT_FAILURE:
            return {
                ...state,
                resolveScheduledEvent: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case FETCH_SCHEDULED_EVENT_REQUEST_SLUG:
            return {
                ...state,
                currentScheduledEvent: {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'ScheduledEvent' does not exist on type '... Remove this comment to see the full error message
                    ...state.ScheduledEvent,
                    requesting: true,
                    error: null,
                    success: false,
                },
            };
        case FETCH_SCHEDULED_EVENT_SUCCESS_SLUG:
            return {
                ...state,
                currentScheduledEvent: {
                    requesting: false,
                    success: true,
                    error: null,
                    scheduledEvent: action.payload,
                },
            };
        case FETCH_SCHEDULED_EVENT_FAILURE_SLUG:
            return {
                ...state,
                currentScheduledEvent: {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduledEvent' does not exist on type '... Remove this comment to see the full error message
                    ...state.scheduledEvent,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        default:
            return state;
    }
}
