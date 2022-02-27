import {
    STATUSPAGE_REQUEST,
    STATUSPAGE_SUCCESS,
    STATUSPAGE_FAILURE,
    STATUSPAGE_NOTES_REQUEST,
    STATUSPAGE_NOTES_SUCCESS,
    STATUSPAGE_NOTES_FAILURE,
    MORE_NOTES_REQUEST,
    MORE_NOTES_SUCCESS,
    MORE_NOTES_FAILURE,
    STATUSPAGE_NOTES_RESET,
    INDIVIDUAL_NOTES_ENABLE,
    INDIVIDUAL_NOTES_DISABLE,
    SCHEDULED_EVENTS_REQUEST,
    SCHEDULED_EVENTS_SUCCESS,
    SCHEDULED_EVENTS_FAILURE,
    ONGOING_SCHEDULED_EVENTS_REQUEST,
    ONGOING_SCHEDULED_EVENTS_SUCCESS,
    ONGOING_SCHEDULED_EVENTS_FAILURE,
    MORE_EVENTS_REQUEST,
    MORE_EVENTS_SUCCESS,
    MORE_EVENTS_FAILURE,
    SCHEDULED_EVENTS_RESET,
    ONGOING_SCHEDULED_EVENTS_RESET,
    SELECT_PROBE,
    FETCH_MONITOR_STATUSES_REQUEST,
    FETCH_MONITOR_STATUSES_SUCCESS,
    FETCH_MONITOR_STATUSES_FAILURE,
    FETCH_MONITOR_LOGS_REQUEST,
    FETCH_MONITOR_LOGS_SUCCESS,
    FETCH_MONITOR_LOGS_FAILURE,
    FETCH_EVENT_NOTES_FAILURE,
    FETCH_EVENT_NOTES_REQUEST,
    FETCH_EVENT_NOTES_SUCCESS,
    FETCH_EVENT_FAILURE,
    FETCH_EVENT_REQUEST,
    FETCH_EVENT_SUCCESS,
    MORE_EVENT_NOTE_FAILURE,
    MORE_EVENT_NOTE_REQUEST,
    MORE_EVENT_NOTE_SUCCESS,
    FETCH_INCIDENT_NOTES_REQUEST,
    FETCH_INCIDENT_NOTES_SUCCESS,
    FETCH_INCIDENT_NOTES_FAILURE,
    FETCH_INCIDENT_REQUEST,
    FETCH_INCIDENT_SUCCESS,
    FETCH_INCIDENT_FAILURE,
    MORE_INCIDENT_NOTES_FAILURE,
    MORE_INCIDENT_NOTES_REQUEST,
    MORE_INCIDENT_NOTES_SUCCESS,
    FUTURE_EVENTS_FAILURE,
    FUTURE_EVENTS_REQUEST,
    FUTURE_EVENTS_SUCCESS,
    MORE_FUTURE_EVENTS_FAILURE,
    MORE_FUTURE_EVENTS_REQUEST,
    MORE_FUTURE_EVENTS_SUCCESS,
    INDIVIDUAL_EVENTS_FAILURE,
    INDIVIDUAL_EVENTS_SUCCESS,
    INDIVIDUAL_EVENTS_REQUEST,
    FETCH_LAST_INCIDENT_TIMELINE_SUCCESS,
    FETCH_LAST_INCIDENT_TIMELINE_REQUEST,
    FETCH_LAST_INCIDENT_TIMELINE_FAILURE,
    FETCH_LAST_INCIDENT_TIMELINES_SUCCESS,
    FETCH_LAST_INCIDENT_TIMELINES_REQUEST,
    FETCH_LAST_INCIDENT_TIMELINES_FAILURE,
    SHOW_EVENT_CARD,
    SHOW_INCIDENT_CARD,
    NEW_THEME_NOTES_SUCCESS,
    FETCH_ANNOUNCEMENTS_REQUEST,
    FETCH_ANNOUNCEMENTS_SUCCESS,
    FETCH_ANNOUNCEMENTS_FAILURE,
    FETCH_SINGLE_ANNOUNCEMENTS_SUCCESS,
    FETCH_ANNOUNCEMEMTLOGS_REQUEST,
    FETCH_ANNOUNCEMEMTLOGS_SUCCESS,
    FETCH_ANNOUNCEMEMTLOGS_FAILURE,
    PAST_EVENTS_REQUEST,
    PAST_EVENTS_SUCCESS,
    PAST_EVENTS_FAILURE,
    MORE_PAST_EVENTS_REQUEST,
    MORE_PAST_EVENTS_SUCCESS,
    MORE_PAST_EVENTS_FAILURE,
    CALCULATE_TIME_REQUEST,
    CALCULATE_TIME_SUCCESS,
    CALCULATE_TIME_FAILURE,
    FETCH_TWEETS_REQUEST,
    FETCH_TWEETS_SUCCESS,
    FETCH_TWEETS_FAILURE,
    FETCH_ALL_RESOURCES_SUCCESS,
    FETCH_EXTERNAL_STATUSPAGES_REQUEST,
    FETCH_EXTERNAL_STATUSPAGES_SUCCESS,
    FETCH_EXTERNAL_STATUSPAGES_FAILURE,
    TRANSLATE_LANGUAGE,
} from '../constants/status';
import moment from 'moment';

const INITIAL_STATE = {
    error: null,
    statusPage: {},
    monitorStatuses: {},
    requesting: false,
    notes: {
        error: null,
        notes: [],
        requesting: false,
        skip: 0,
    },
    events: {
        error: null,
        events: [],
        requesting: false,
        skip: 0,
        count: 0,
    },
    ongoing: {
        error: null,
        ongoing: [],
        requesting: false,
        success: false,
    },
    futureEvents: {
        requesting: false,
        success: false,
        error: null,
        events: [],
        skip: 0,
        count: 0,
    },
    moreFutureEvents: {
        requesting: false,
        success: false,
        error: null,
    },
    pastEvents: {
        requesting: false,
        success: false,
        error: null,
        events: [],
        skip: 0,
        count: 0,
    },
    morePastEvents: {
        requesting: false,
        success: false,
        error: null,
    },
    individualEvents: {
        requesting: false,
        success: false,
        error: null,
        events: [],
        count: 0,
        show: false,
        monitorName: null,
        date: null,
    },
    logs: [],
    requestingmore: false,
    requestingmoreevents: false,
    requestingstatuses: false,
    individualnote: null,
    notesmessage: null,
    activeProbe: 0,
    eventNoteList: {
        requesting: false,
        success: false,
        error: null,
        eventNotes: [],
        skip: 0,
        count: 0,
    },
    requestingMoreNote: false,
    moreNoteError: null,
    scheduledEvent: {
        requesting: false,
        success: false,
        error: null,
        event: {},
    },
    incident: {
        requesting: false,
        success: false,
        error: null,
        incident: {},
    },
    incidentNotes: {
        requesting: false,
        success: false,
        error: null,
        notes: [],
        skip: 0,
        count: 0,
    },
    moreIncidentNotes: false,
    moreIncidentNotesError: null,
    language: 'english',
    lastIncidentTimeline: {
        requesting: false,
        success: false,
        error: null,
        timeline: {},
    },
    lastIncidentTimelines: {
        requesting: false,
        success: false,
        error: null,
        timelines: [],
    },
    showEventCard: false,
    showIncidentCard: true,
    newThemeIncidentNotes: {
        notes: [],
        requesting: false,
        error: null,
        success: false,
    },
    announcements: {
        list: [],
        singleAnnouncement: null,
        requesting: false,
        error: null,
        success: false,
    },
    announcementLogs: {
        logsList: [],
        requesting: false,
        success: false,
        error: null,
    },
    monitorInfo: {
        requesting: {},
        success: {},
        error: null,
        info: {},
    },
    tweets: {
        requesting: false,
        success: false,
        error: null,
        tweetList: [],
    },
};

export default (state = INITIAL_STATE, action: $TSFixMe) => {
    let monitorTimeRequest: $TSFixMe;
    let monitorTimeSuccess: $TSFixMe;
    switch (action.type) {
        case FETCH_ANNOUNCEMEMTLOGS_REQUEST:
            return Object.assign({}, state, {
                announcementLogs: {
                    ...state.announcementLogs,
                    requesting: true,
                    success: false,
                    error: null,
                },
            });
        case FETCH_ANNOUNCEMEMTLOGS_FAILURE:
            return Object.assign({}, state, {
                announcementLogs: {
                    ...state.announcementLogs,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });
        case FETCH_ANNOUNCEMEMTLOGS_SUCCESS:
            return Object.assign({}, state, {
                announcementLogs: {
                    ...state.announcementLogs,
                    logsList: action.payload,
                    requesting: false,
                    success: true,
                    error: null,
                },
            });
        case FETCH_SINGLE_ANNOUNCEMENTS_SUCCESS:
            return Object.assign({}, state, {
                announcements: {
                    ...state.announcements,
                    singleAnnouncement: action.payload,
                    requesting: false,
                    error: null,
                    success: true,
                },
            });
        case FETCH_ANNOUNCEMENTS_SUCCESS:
            return Object.assign({}, state, {
                announcements: {
                    ...state.announcements,
                    list: action.payload,
                    requesting: false,
                    error: null,
                    success: true,
                },
            });
        case FETCH_ANNOUNCEMENTS_REQUEST:
            return Object.assign({}, state, {
                announcements: {
                    ...state.announcements,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });
        case FETCH_ANNOUNCEMENTS_FAILURE:
            return Object.assign({}, state, {
                announcements: {
                    ...state.announcements,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });
        case STATUSPAGE_SUCCESS:
            return Object.assign({}, state, {
                error: null,
                statusPage: action.payload,
                requesting: false,
            });

        case STATUSPAGE_FAILURE:
            return Object.assign({}, state, {
                error: action.payload,
                requesting: false,
            });

        case STATUSPAGE_REQUEST:
            return Object.assign({}, state, {
                error: null,
                requesting: true,
            });

        case 'UPDATE_STATUS_PAGE': {
            const isValidMonitorNote =
                state.individualnote &&
                action.payload.monitorIds &&
                action.payload.monitorIds.length > 0 &&
                action.payload.monitorIds.find(
                    // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                    (monitor: $TSFixMe) =>
                        monitor._id === state.individualnote._id
                );
            return Object.assign({}, state, {
                error: null,
                statusPage: {
                    ...action.payload,

                    monitorsData:
                        action.payload.monitorsData &&
                        action.payload.monitorsData.length > 0
                            ? action.payload.monitorsData.map(
                                  (newMonitorData: $TSFixMe) => {
                                      if (
                                          // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsData' does not exist on type '{}... Remove this comment to see the full error message
                                          state.statusPage.monitorsData &&
                                          // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsData' does not exist on type '{}... Remove this comment to see the full error message
                                          state.statusPage.monitorsData.length >
                                              0
                                      ) {
                                          // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsData' does not exist on type '{}... Remove this comment to see the full error message
                                          state.statusPage.monitorsData.forEach(
                                              (oldMonitorData: $TSFixMe) => {
                                                  if (
                                                      newMonitorData._id ===
                                                      oldMonitorData._id
                                                  ) {
                                                      newMonitorData.statuses =
                                                          oldMonitorData.statuses;
                                                  }
                                              }
                                          );
                                      }

                                      return newMonitorData;
                                  }
                              )
                            : [],
                },
                individualnote: isValidMonitorNote
                    ? state.individualnote
                    : null,
                notesmessage: isValidMonitorNote ? state.notesmessage : null,
                requesting: false,
            });
        }

        case 'UPDATE_MONITOR':
            return Object.assign({}, state, {
                error: null,
                statusPage: {
                    ...state.statusPage,

                    monitorIds:
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorIds' does not exist on type '{}'.
                        state.statusPage.monitorIds &&
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorIds' does not exist on type '{}'.
                        state.statusPage.monitorIds.length > 0
                            ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorIds' does not exist on type '{}'.
                              state.statusPage.monitorIds.map(
                                  (monitor: $TSFixMe) => {
                                      if (monitor._id === action.payload._id) {
                                          monitor.name = action.payload.name;
                                      }
                                      return monitor;
                                  }
                              )
                            : [],
                    monitorsData:
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsData' does not exist on type '{}... Remove this comment to see the full error message
                        state.statusPage.monitorsData &&
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsData' does not exist on type '{}... Remove this comment to see the full error message
                        state.statusPage.monitorsData.length > 0
                            ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsData' does not exist on type '{}... Remove this comment to see the full error message
                              state.statusPage.monitorsData.map(
                                  (monitor: $TSFixMe) => {
                                      if (monitor._id === action.payload._id) {
                                          return {
                                              ...monitor,
                                              ...action.payload,
                                              monitorCategoryId:
                                                  action.payload
                                                      .monitorCategoryId,
                                          };
                                      }
                                      return monitor;
                                  }
                              )
                            : [],
                },
                requesting: false,
            });

        case 'DELETE_MONITOR': {
            const isIndividualNote =
                state.individualnote &&
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                state.individualnote._id === action.payload;
            return Object.assign({}, state, {
                error: null,
                statusPage: {
                    ...state.statusPage,

                    monitorIds:
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorIds' does not exist on type '{}'.
                        state.statusPage.monitorIds &&
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorIds' does not exist on type '{}'.
                        state.statusPage.monitorIds.length > 0
                            ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorIds' does not exist on type '{}'.
                              state.statusPage.monitorIds.filter(
                                  (monitor: $TSFixMe) =>
                                      monitor._id !== action.payload
                              )
                            : [],
                    monitorsData:
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsData' does not exist on type '{}... Remove this comment to see the full error message
                        state.statusPage.monitorsData &&
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsData' does not exist on type '{}... Remove this comment to see the full error message
                        state.statusPage.monitorsData.length > 0
                            ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsData' does not exist on type '{}... Remove this comment to see the full error message
                              state.statusPage.monitorsData.filter(
                                  (monitor: $TSFixMe) =>
                                      monitor._id !== action.payload
                              )
                            : [],
                },
                individualnote: isIndividualNote ? null : state.individualnote,
                notesmessage: isIndividualNote ? null : state.notesmessage,
                requesting: false,
            });
        }

        case STATUSPAGE_NOTES_SUCCESS:
            return Object.assign({}, state, {
                notes: {
                    error: null,
                    notes:
                        action.payload && action.payload.data
                            ? action.payload.data
                            : [],
                    requesting: false,
                    skip:
                        action.payload && action.payload.skip
                            ? action.payload.skip
                            : 0,
                    count:
                        action.payload && action.payload.count
                            ? action.payload.count
                            : 0,
                },
            });

        case NEW_THEME_NOTES_SUCCESS:
            return Object.assign({}, state, {
                newThemeIncidentNotes: {
                    error: null,
                    notes:
                        action.payload && action.payload.data
                            ? action.payload.data
                            : [],
                    requesting: false,
                    success: true,
                },
            });

        case STATUSPAGE_NOTES_FAILURE:
            return Object.assign({}, state, {
                notes: {
                    error: action.payload,
                    notes: state.notes.notes,
                    requesting: false,
                    skip: state.notes.skip,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type '{ error: ... Remove this comment to see the full error message
                    count: state.notes.count,
                },
            });

        case STATUSPAGE_NOTES_REQUEST:
            return Object.assign({}, state, {
                notes: {
                    error: null,
                    notes: [],
                    requesting: true,
                    skip: 0,
                    count: 0,
                },
            });

        case STATUSPAGE_NOTES_RESET:
            return Object.assign({}, state, {
                notes: {
                    error: null,
                    notes: [],
                    requesting: false,
                    skip: 0,
                    count: 0,
                },
            });

        case 'ADD_INCIDENT_NOTE': {
            let addToIncident = false;
            let notes = [...state.incidentNotes.notes];
            const noteData = state.notes.notes,
                result: $TSFixMe = [];
            const check = noteData.find(
                note =>
                    // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                    String(note._id) === String(action.payload.incidentId._id)
            );
            if (
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type '{}'.
                String(state.incident.incident._id) ===
                String(action.payload.incidentId._id)
            ) {
                addToIncident = true;
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'any' is not assignable to type 'never'.
                notes = [action.payload, ...notes];
            }
            if (check && noteData) {
                let oneNote: $TSFixMe;
                noteData.forEach(item => {
                    if (
                        // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                        String(item._id) ===
                        String(action.payload.incidentId._id)
                    ) {
                        const messageLog =
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'message' does not exist on type 'never'.
                            item.message && item.message.length > 0
                                ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'message' does not exist on type 'never'.
                                  item.message
                                : [];
                        oneNote = {
                            // @ts-expect-error ts-migrate(2698) FIXME: Spread types may only be created from object types... Remove this comment to see the full error message
                            ...item,
                            message: [...messageLog, action.payload],
                        };
                    }
                });
                noteData.forEach(elem => {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                    if (String(elem._id) === String(oneNote._id)) {
                        // @ts-expect-error ts-migrate(2322) FIXME: Type 'any' is not assignable to type 'never'.
                        elem = oneNote;
                    }
                    result.push(elem);
                });
                notes = result;
            }

            return {
                ...state,
                incidentNotes: {
                    ...state.incidentNotes,
                    notes,
                    count: addToIncident
                        ? state.incidentNotes.count + 1
                        : state.incidentNotes.count,
                },
                notes: {
                    ...state.notes,
                    notes: notes,
                },
            };
        }

        case 'UPDATE_INCIDENT_NOTE': {
            let notes = [...state.incidentNotes.notes];
            if (
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type '{}'.
                String(state.incident.incident._id) ===
                String(action.payload.incidentId._id)
            ) {
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'any[]' is not assignable to type 'never[]'.
                notes = state.incidentNotes.notes.map(note => {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                    if (String(note._id) === String(action.payload._id)) {
                        return action.payload;
                    }
                    return note;
                });
            }

            return {
                ...state,
                incidentNotes: {
                    ...state.incidentNotes,
                    notes,
                },
            };
        }

        case 'DELETE_INCIDENT_NOTE': {
            const notes = state.incidentNotes.notes.filter(
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                note => String(note._id) !== String(action.payload._id)
            );
            return {
                ...state,
                incidentNotes: {
                    ...state.incidentNotes,
                    notes,
                    count: state.incidentNotes.count - 1,
                },
            };
        }

        case MORE_NOTES_SUCCESS:
            return Object.assign({}, state, {
                notes: {
                    error: null,
                    notes: state.notes.notes.concat(action.payload.data),
                    requesting: false,
                    skip: action.payload.skip,
                    count: action.payload.count
                        ? action.payload.count
                        : // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type '{ error: ... Remove this comment to see the full error message
                          state.notes.count,
                },
                requestingmore: false,
            });

        case MORE_NOTES_FAILURE:
            return Object.assign({}, state, {
                notes: {
                    error: action.payload,
                    notes: state.notes.notes,
                    requesting: false,
                    skip: state.notes.skip,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type '{ error: ... Remove this comment to see the full error message
                    count: state.notes.count,
                },
                requestingmore: false,
            });

        case MORE_NOTES_REQUEST:
            return Object.assign({}, state, { requestingmore: true });

        case INDIVIDUAL_NOTES_ENABLE:
            return Object.assign({}, state, {
                individualnote: action.payload.name,
                notesmessage: action.payload.message,
            });

        case INDIVIDUAL_NOTES_DISABLE:
            return Object.assign({}, state, {
                individualnote: null,
                notesmessage: null,
            });

        case SCHEDULED_EVENTS_SUCCESS:
            return Object.assign({}, state, {
                events: {
                    error: null,
                    events:
                        action.payload && action.payload.data
                            ? action.payload.data
                            : [],
                    requesting: false,
                    skip:
                        action.payload && action.payload.skip
                            ? action.payload.skip
                            : 0,
                    count:
                        action.payload && action.payload.count
                            ? action.payload.count
                            : 0,
                },
            });

        case 'RESOLVE_SCHEDULED_EVENT': {
            const events = state.events.events.filter(
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                event => String(event._id) !== String(action.payload._id)
            );
            return {
                ...state,
                events: {
                    ...state.events,
                    events,
                    count: events.length,
                },
            };
        }

        case SCHEDULED_EVENTS_FAILURE:
            return Object.assign({}, state, {
                events: {
                    error: action.payload,
                    events: state.events.events,
                    requesting: false,
                    skip: state.events.skip,
                    count: state.events.count,
                },
            });

        case SCHEDULED_EVENTS_REQUEST:
            return Object.assign({}, state, {
                events: {
                    error: null,
                    events: [],
                    requesting: true,
                    skip: 0,
                    count: 0,
                },
            });

        case SCHEDULED_EVENTS_RESET:
            return Object.assign({}, state, {
                events: {
                    error: null,
                    events: [],
                    requesting: false,
                    skip: 0,
                    count: 0,
                },
            });

        case ONGOING_SCHEDULED_EVENTS_SUCCESS:
            return Object.assign({}, state, {
                ongoing: {
                    error: null,
                    ongoing: action.payload.data,
                    requesting: false,
                },
            });

        case ONGOING_SCHEDULED_EVENTS_FAILURE:
            return Object.assign({}, state, {
                ongoing: {
                    error: action.payload,
                    ongoing: state.ongoing.ongoing,
                    requesting: false,
                },
            });

        case ONGOING_SCHEDULED_EVENTS_REQUEST:
            return Object.assign({}, state, {
                ongoing: {
                    error: null,
                    ongoing: [],
                    requesting: true,
                },
            });

        case ONGOING_SCHEDULED_EVENTS_RESET:
            return Object.assign({}, state, {
                ongoing: {
                    error: null,
                    ongoing: [],
                    requesting: false,
                },
            });

        case 'ADD_SCHEDULED_EVENT': {
            let monitorInStatusPage = false;
            let addEvent = false;
            let addFutureEvent = false;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type '{}'.
            state.statusPage.monitors.map((monitorData: $TSFixMe) => {
                action.payload.monitors.map((monitor: $TSFixMe) => {
                    if (
                        String(monitor.monitorId._id) ===
                        String(monitorData.monitor._id)
                    ) {
                        monitorInStatusPage = true;
                    }
                    return monitor;
                });
                return monitorData;
            });

            const currentDate = moment().format();
            const startDate = moment(action.payload.startDate).format();
            const endDate = moment(action.payload.endDate).format();
            if (
                monitorInStatusPage &&
                startDate <= currentDate &&
                endDate >= currentDate
            ) {
                addEvent = true;
            }

            if (monitorInStatusPage && startDate > currentDate) {
                addFutureEvent = true;
            }

            return Object.assign({}, state, {
                events: {
                    ...state.events,
                    events: addEvent
                        ? [action.payload, ...state.events.events]
                        : [...state.events.events],
                    count: addEvent
                        ? state.events.count + 1
                        : state.events.count,
                },
                futureEvents: {
                    ...state.futureEvents,
                    events: addFutureEvent
                        ? [action.payload, ...state.futureEvents.events]
                        : [...state.futureEvents.events],
                    count: addFutureEvent
                        ? state.futureEvents.count + 1
                        : state.futureEvents.count,
                },
            });
        }

        case 'DELETE_SCHEDULED_EVENT': {
            const currentDate = moment().format();
            const startDate = moment(action.payload.startDate).format();
            let isFutureEvent = false;
            let events = [];
            if (startDate > currentDate) {
                isFutureEvent = true;
                events = state.futureEvents.events.filter(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                    event => String(event._id) !== String(action.payload._id)
                );
            } else {
                events = state.events.events.filter(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                    event => String(event._id) !== String(action.payload._id)
                );
            }
            return {
                ...state,
                events: {
                    ...state.events,
                    events: !isFutureEvent ? events : [...state.events.events],
                    count: !isFutureEvent
                        ? state.events.count - 1
                        : state.events.count,
                },
                futureEvents: {
                    ...state.futureEvents,
                    events: isFutureEvent
                        ? events
                        : [...state.futureEvents.events],
                    count: isFutureEvent
                        ? state.futureEvents.count - 1
                        : state.futureEvents.count,
                },
            };
        }

        case 'UPDATE_SCHEDULED_EVENT': {
            let addEvent = false;
            let addFutureEvent = false;
            let futureEventExist = false;
            let eventExist = false;
            let monitorInStatusPage = false;
            const currentDate = moment().format();
            const startDate = moment(action.payload.startDate).format();
            const endDate = moment(action.payload.endDate).format();

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type '{}'.
            state.statusPage.monitors.map((monitorData: $TSFixMe) => {
                action.payload.monitors.map((monitor: $TSFixMe) => {
                    if (
                        String(monitor.monitorId._id) ===
                        String(monitorData.monitor)
                    ) {
                        monitorInStatusPage = true;
                    }
                    return monitor;
                });
                return monitorData;
            });

            const updatedEvents = state.events.events.map(event => {
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                if (String(event._id) === String(action.payload._id)) {
                    eventExist = true;
                    // @ts-expect-error ts-migrate(2322) FIXME: Type 'any' is not assignable to type 'never'.
                    event = action.payload;
                }
                return event;
            });

            const updatedFutureEvent = state.futureEvents.events.map(event => {
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                if (String(event._id) === String(action.payload._id)) {
                    futureEventExist = true;
                    // @ts-expect-error ts-migrate(2322) FIXME: Type 'any' is not assignable to type 'never'.
                    event = action.payload;
                }
                return event;
            });

            if (!eventExist) {
                // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'any' is not assignable to parame... Remove this comment to see the full error message
                updatedEvents.unshift(action.payload);
            }

            if (!futureEventExist) {
                // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'any' is not assignable to parame... Remove this comment to see the full error message
                updatedFutureEvent.unshift(action.payload);
            }

            const removeEvent = state.events.events.filter(
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                event => String(event._id) !== String(action.payload._id)
            );

            const removeFutureEvent = state.futureEvents.events.filter(
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                event => String(event._id) !== String(action.payload._id)
            );

            if (
                monitorInStatusPage &&
                startDate <= currentDate &&
                endDate >= currentDate
            ) {
                addEvent = true;
            }

            if (monitorInStatusPage && startDate > currentDate) {
                addFutureEvent = true;
            }

            return Object.assign({}, state, {
                events: {
                    ...state.events,
                    events: addEvent ? updatedEvents : removeEvent,
                    count: addEvent ? updatedEvents.length : removeEvent.length,
                },
                futureEvents: {
                    ...state.events,
                    events: addFutureEvent
                        ? updatedFutureEvent
                        : removeFutureEvent,
                    count: addFutureEvent
                        ? updatedFutureEvent.length
                        : removeFutureEvent.length,
                },
                scheduledEvent: {
                    ...state.scheduledEvent,
                    event: action.payload,
                },
            });
        }

        case MORE_EVENTS_SUCCESS:
            return Object.assign({}, state, {
                events: {
                    error: null,
                    events: state.events.events.concat(action.payload.data),
                    requesting: false,
                    skip: action.payload.skip,
                    count: action.payload.count
                        ? action.payload.count
                        : state.events.count,
                },
                requestingmoreevents: false,
            });

        case MORE_EVENTS_FAILURE:
            return Object.assign({}, state, {
                events: {
                    error: action.payload,
                    events: state.events.events,
                    requesting: false,
                    skip: state.events.skip,
                    count: state.events.count,
                },
                requestingmoreevents: false,
            });

        case MORE_EVENTS_REQUEST:
            return Object.assign({}, state, { requestingmoreevents: true });

        case MORE_FUTURE_EVENTS_REQUEST:
            return {
                ...state,
                moreFutureEvents: {
                    requesting: true,
                    success: false,
                    error: null,
                },
                individualEvents: {
                    ...state.individualEvents,
                    show: false,
                },
            };

        case MORE_FUTURE_EVENTS_SUCCESS:
            return {
                ...state,
                moreFutureEvents: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                futureEvents: {
                    ...state.futureEvents,
                    events: state.futureEvents.events.concat(
                        action.payload.data
                    ),
                    skip: action.payload.skip,
                    count: action.payload.count
                        ? action.payload.count
                        : state.events.count,
                },
            };

        case MORE_FUTURE_EVENTS_FAILURE:
            return {
                ...state,
                moreFutureEvents: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case MORE_PAST_EVENTS_REQUEST:
            return {
                ...state,
                morePastEvents: {
                    requesting: true,
                    success: false,
                    error: null,
                },
                individualEvents: {
                    ...state.individualEvents,
                    show: false,
                },
            };

        case MORE_PAST_EVENTS_SUCCESS:
            return {
                ...state,
                morePastEvents: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                pastEvents: {
                    ...state.pastEvents,
                    events: state.pastEvents.events.concat(action.payload.data),
                    skip: action.payload.skip,
                    count: action.payload.count
                        ? action.payload.count
                        : state.events.count,
                },
            };

        case MORE_PAST_EVENTS_FAILURE:
            return {
                ...state,
                morePastEvents: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case INDIVIDUAL_EVENTS_REQUEST:
            return {
                ...state,
                individualEvents: {
                    ...state.individualEvents,
                    requesting: true,
                    success: false,
                    error: null,
                    show: true,
                },
                showEventCard: false,
            };

        case INDIVIDUAL_EVENTS_SUCCESS:
            return {
                ...state,
                individualEvents: {
                    requesting: false,
                    success: true,
                    error: null,
                    events: action.payload.data,
                    count: action.payload.count,
                    monitorName: action.payload.monitorName,
                    date: action.payload.date,
                    show: true,
                },
            };

        case INDIVIDUAL_EVENTS_FAILURE:
            return {
                ...state,
                individualEvents: {
                    ...state.individualEvents,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case SELECT_PROBE:
            return Object.assign({}, state, {
                activeProbe: action.payload,
            });

        case FETCH_MONITOR_STATUSES_REQUEST:
            return Object.assign({}, state, {
                requestingstatuses: true,
                monitorStatuses: {
                    ...state.monitorStatuses,
                    [action.payload]: null,
                },
            });

        case FETCH_MONITOR_STATUSES_SUCCESS:
            return Object.assign({}, state, {
                statusPage: {
                    ...state.statusPage,

                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsData' does not exist on type '{}... Remove this comment to see the full error message
                    monitorsData: state.statusPage.monitorsData.map(
                        (monitor: $TSFixMe) => {
                            if (
                                String(monitor._id) ===
                                String(action.payload.monitorId)
                            ) {
                                monitor.statuses = action.payload.statuses.data;
                            }
                            return monitor;
                        }
                    ),
                },
                requestingstatuses: false,
                monitorStatuses: {
                    ...state.monitorStatuses,
                    [action.payload.monitorId]: action.payload.statuses.data,
                },
            });

        case FETCH_MONITOR_STATUSES_FAILURE:
            return Object.assign({}, state, {
                statusPage: {
                    ...state.statusPage,

                    requesting: false,
                    error: action.payload,
                    success: false,
                },
                requestingstatuses: false,
            });

        case 'UPDATE_MONITOR_STATUS':
            return Object.assign({}, state, {
                statusPage: {
                    ...state.statusPage,

                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsData' does not exist on type '{}... Remove this comment to see the full error message
                    monitorsData: state.statusPage.monitorsData.map(
                        (monitor: $TSFixMe) => {
                            if (
                                monitor._id === action.payload.status.monitorId
                            ) {
                                const data = Object.assign(
                                    {},
                                    action.payload.status.data
                                );
                                const probes = action.payload.probes;
                                const isValidProbe =
                                    (monitor.type === 'url' ||
                                        monitor.type === 'api' ||
                                        monitor.type === 'ip') &&
                                    probes &&
                                    probes.length > 0;

                                if (
                                    monitor.statuses &&
                                    monitor.statuses.length > 0
                                ) {
                                    const monitorProbes = monitor.statuses.map(
                                        (a: $TSFixMe) => a._id
                                    );

                                    if (
                                        monitorProbes.includes(data.probeId) ||
                                        !data.probeId
                                    ) {
                                        monitor.statuses = monitor.statuses.map(
                                            (probeStatuses: $TSFixMe) => {
                                                const probeId =
                                                    probeStatuses._id;

                                                if (
                                                    probeId === data.probeId ||
                                                    !data.probeId
                                                ) {
                                                    const previousStatus =
                                                        probeStatuses
                                                            .statuses[0];
                                                    previousStatus.endTime = new Date().toISOString();

                                                    return {
                                                        _id: probeId,
                                                        statuses: [
                                                            data,
                                                            previousStatus,
                                                            ...probeStatuses.statuses.slice(
                                                                1
                                                            ),
                                                        ],
                                                    };
                                                } else {
                                                    return probeStatuses;
                                                }
                                            }
                                        );

                                        if (
                                            isValidProbe &&
                                            !probes.every((probe: $TSFixMe) =>
                                                monitorProbes.includes(
                                                    probe._id
                                                )
                                            )
                                        ) {
                                            // add manual status to all new probes
                                            const newProbeStatuses: $TSFixMe = [];

                                            probes.forEach(
                                                (probe: $TSFixMe) => {
                                                    if (
                                                        !monitorProbes.includes(
                                                            probe._id
                                                        )
                                                    ) {
                                                        newProbeStatuses.push({
                                                            _id: probe._id,
                                                            statuses: [data],
                                                        });
                                                    }
                                                }
                                            );

                                            monitor.statuses = [
                                                ...monitor.statuses,
                                                ...newProbeStatuses,
                                            ];
                                        }
                                    } else {
                                        monitor.statuses = [
                                            ...monitor.statuses,
                                            {
                                                _id: data.probeId || null,
                                                statuses: [data],
                                            },
                                        ];
                                    }
                                } else {
                                    if (isValidProbe) {
                                        monitor.statuses = probes.map(
                                            (probe: $TSFixMe) => ({
                                                _id: probe._id,
                                                statuses: [data],
                                            })
                                        );
                                    } else {
                                        monitor.statuses = [
                                            {
                                                _id: data.probeId || null,
                                                statuses: [data],
                                            },
                                        ];
                                    }
                                }
                            }
                            return monitor;
                        }
                    ),
                },
                requestingstatuses: false,
            });
        case FETCH_ALL_RESOURCES_SUCCESS:
            monitorTimeRequest = {};
            monitorTimeSuccess = {};

            Object.keys(action.payload.time).map(id => {
                monitorTimeRequest[id] = false;
                monitorTimeSuccess[id] = true;
                return id;
            });
            return Object.assign({}, state, {
                statusPage: action.payload.statusPages,
                announcements: {
                    ...state.announcements,
                    list: action.payload.announcement,
                    requesting: false,
                    error: null,
                    success: true,
                },
                requestingstatuses: false,
                requesting: false,
                monitorStatuses: action.payload.monitorStatus,
                logs: action.payload.monitorLogs.map((log: $TSFixMe) => ({
                    monitorId: log.monitorId,
                    logs: log.logs,
                    count: log.logs.count,
                })),
                lastIncidentTimelines: {
                    requesting: false,
                    success: true,
                    error: null,
                    timelines: action.payload.timelines,
                },
                notes: {
                    error: null,
                    notes:
                        action.payload && action.payload.statusPageNote.result
                            ? action.payload.statusPageNote.result
                            : [],
                    requesting: false,
                    skip: 0,
                    count:
                        action.payload.statusPageNote &&
                        action.payload.statusPageNote.count
                            ? action.payload.statusPageNote.count
                            : 0,
                },
                announcementLogs: {
                    ...state.announcementLogs,
                    logsList: action.payload.announcementLogs,
                    requesting: false,
                    success: true,
                    error: null,
                },
                ongoing: {
                    error: null,
                    ongoing:
                        action.payload.ongoingEvents &&
                        action.payload.ongoingEvents.events,
                    requesting: false,
                },
                moreFutureEvents: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                futureEvents: {
                    ...state.futureEvents,
                    requesting: false,
                    success: true,
                    error: null,
                    events: action.payload.futureEvents.events || [],
                    skip: 0,
                    count: action.payload.futureEvents.count,
                },
                pastEvents: {
                    requesting: false,
                    success: true,
                    error: null,
                    events: action.payload.pastEvents.events || [],
                    count: action.payload.pastEvents.count,
                    skip: action.payload.skip || 0,
                },
                individualEvents: {
                    // reset individualEvents state
                    ...INITIAL_STATE.individualEvents,
                },
                monitorInfo: {
                    requesting: monitorTimeRequest,
                    success: monitorTimeSuccess,
                    error: null,
                    info: action.payload.time,
                },
            });
        case FETCH_MONITOR_LOGS_REQUEST:
            return Object.assign({}, state, {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type 'never... Remove this comment to see the full error message
                logs: state.logs.some(log => log.monitorId === action.payload)
                    ? state.logs.map(log =>
                          // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type 'never... Remove this comment to see the full error message
                          log.monitorId !== action.payload
                              ? log
                              : {
                                    monitorId: action.payload,
                                    error: null,
                                    logs: [],
                                    requesting: true,
                                }
                      )
                    : [
                          ...state.logs,
                          {
                              monitorId: action.payload,
                              logs: [],
                              requesting: true,
                              error: null,
                          },
                      ],
            });
        case FETCH_MONITOR_LOGS_SUCCESS:
            return Object.assign({}, state, {
                logs: state.logs.map(log =>
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type 'never... Remove this comment to see the full error message
                    log.monitorId !== action.payload.monitorId
                        ? log
                        : {
                              monitorId: action.payload.monitorId,
                              logs:
                                  action.payload.logs.data.length === 0
                                      ? []
                                      : action.payload.logs.data[0].logs,
                              requesting: false,
                              error: null,
                          }
                ),
            });
        case FETCH_MONITOR_LOGS_FAILURE:
            return Object.assign({}, state, {
                logs: state.logs.map(log =>
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type 'never... Remove this comment to see the full error message
                    log.monitorId !== action.payload
                        ? log
                        : {
                              monitorId: action.payload.monitorId,
                              logs: [],
                              requesting: false,
                              error: action.payload,
                          }
                ),
            });

        case FETCH_EVENT_REQUEST:
            return {
                ...state,
                scheduledEvent: {
                    ...state.scheduledEvent,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case FETCH_EVENT_SUCCESS:
            return {
                ...state,
                scheduledEvent: {
                    requesting: false,
                    success: true,
                    error: null,
                    event: action.payload.data,
                },
            };

        case FETCH_EVENT_FAILURE:
            return {
                ...state,
                scheduledEvent: {
                    ...state.scheduledEvent,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case FETCH_EVENT_NOTES_REQUEST:
            return {
                ...state,
                eventNoteList: {
                    ...state.eventNoteList,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case FETCH_EVENT_NOTES_SUCCESS:
            return {
                ...state,
                eventNoteList: {
                    ...state.eventNoteList,
                    requesting: false,
                    success: true,
                    error: null,
                    eventNotes: action.payload.data,
                    count: action.payload.count,
                },
            };

        case 'ADD_EVENT_NOTE': {
            let eventNotes = [...state.eventNoteList.eventNotes];
            let increaseCount = false;
            if (
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type '{}'.
                String(state.scheduledEvent.event._id) ===
                String(action.payload.scheduledEventId._id)
            ) {
                increaseCount = true;
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'any' is not assignable to type 'never'.
                eventNotes = [action.payload, ...eventNotes];
            }
            return {
                ...state,
                eventNoteList: {
                    ...state.eventNoteList,
                    eventNotes,
                    count: increaseCount
                        ? state.eventNoteList.count + 1
                        : state.eventNoteList.count,
                },
            };
        }

        case 'DELETE_EVENT_NOTE': {
            let eventNotes = [...state.eventNoteList.eventNotes];
            let reduceCount = false;
            if (
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type '{}'.
                String(state.scheduledEvent.event._id) ===
                String(action.payload.scheduledEventId._id)
            ) {
                reduceCount = true;
                eventNotes = state.eventNoteList.eventNotes.filter(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                    note => String(note._id) !== String(action.payload._id)
                );
            }
            return {
                ...state,
                eventNoteList: {
                    ...state.eventNoteList,
                    eventNotes,
                    count: reduceCount
                        ? state.eventNoteList.count - 1
                        : state.eventNoteList.count,
                },
            };
        }

        case 'UPDATE_EVENT_NOTE': {
            let eventNotes = [...state.eventNoteList.eventNotes];
            if (
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type '{}'.
                String(state.scheduledEvent.event._id) ===
                String(action.payload.scheduledEventId._id)
            ) {
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'any[]' is not assignable to type 'never[]'.
                eventNotes = state.eventNoteList.eventNotes.map(note => {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                    if (String(note._id) === String(action.payload._id)) {
                        return action.payload;
                    }
                    return note;
                });
            }
            return {
                ...state,
                eventNoteList: {
                    ...state.eventNoteList,
                    eventNotes,
                },
            };
        }

        case FETCH_EVENT_NOTES_FAILURE:
            return {
                ...state,
                eventNoteList: {
                    ...state.eventNoteList,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case MORE_EVENT_NOTE_REQUEST:
            return {
                ...state,
                requestingMoreNote: true,
                moreNoteError: null,
            };

        case MORE_EVENT_NOTE_SUCCESS: {
            return {
                ...state,
                eventNoteList: {
                    ...state.eventNoteList,
                    eventNotes: [
                        ...state.eventNoteList.eventNotes,
                        ...action.payload.data,
                    ],
                    skip: action.payload.skip,
                },
                requestingMoreNote: false,
                moreNoteError: null,
            };
        }

        case MORE_EVENT_NOTE_FAILURE:
            return {
                ...state,
                requestingMoreNote: false,
                moreNoteError: action.payload,
            };

        case FETCH_INCIDENT_REQUEST:
            return {
                ...state,
                incident: {
                    ...state.incident,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case FETCH_INCIDENT_SUCCESS:
            return {
                ...state,
                incident: {
                    requesting: false,
                    success: true,
                    error: null,
                    incident: action.payload,
                },
            };

        case FETCH_INCIDENT_FAILURE:
            return {
                ...state,
                incident: {
                    ...state.incident,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case FETCH_INCIDENT_NOTES_REQUEST:
            return {
                ...state,
                incidentNotes: {
                    ...state.incidentNotes,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case FETCH_INCIDENT_NOTES_SUCCESS:
            return {
                ...state,
                incidentNotes: {
                    ...state.incidentNotes,
                    requesting: false,
                    success: true,
                    error: null,
                    notes: action.payload.data,
                    count: action.payload.count,
                },
            };

        case FETCH_INCIDENT_NOTES_FAILURE:
            return {
                ...state,
                incidentNotes: {
                    ...state.incidentNotes,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case MORE_INCIDENT_NOTES_REQUEST:
            return {
                ...state,
                moreIncidentNotes: true,
            };

        case MORE_INCIDENT_NOTES_SUCCESS:
            return {
                ...state,
                moreIncidentNotes: false,
                incidentNotes: {
                    ...state.incidentNotes,
                    notes: [
                        ...state.incidentNotes.notes,
                        ...action.payload.data,
                    ],
                    skip: action.payload.skip,
                },
            };

        case MORE_INCIDENT_NOTES_FAILURE:
            return {
                ...state,
                moreIncidentNotes: false,
                moreIncidentNotesError: action.payload,
            };

        case 'INCIDENT_CREATED': {
            let incidentFound = false;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type '{}'.
            const statusPageMonitorIds = state.statusPage.monitors.map(
                (monitorData: $TSFixMe) => String(monitorData.monitor._id)
            );
            let notes = state.notes.notes.map(note => {
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                if (String(note._id) === String(action.payload._id)) {
                    incidentFound = true;
                }
                return note;
            });
            const monitors = action.payload
                ? action.payload.monitors.map(
                      (monitor: $TSFixMe) => monitor.monitorId
                  )
                : [];
            // once we find at least one monitor in the statusPageMonitorIds array
            // we break out of the loop and add the incident to the list
            for (const monitor of monitors) {
                if (
                    !incidentFound &&
                    statusPageMonitorIds.includes(String(monitor._id))
                ) {
                    // @ts-expect-error ts-migrate(2322) FIXME: Type 'any' is not assignable to type 'never'.
                    notes = [action.payload, ...notes];
                    break;
                }
            }
            return {
                ...state,
                notes: {
                    ...state.notes,
                    notes,
                    count: incidentFound
                        ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type '{ error: ... Remove this comment to see the full error message
                          state.notes.count
                        : // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type '{ error: ... Remove this comment to see the full error message
                          state.notes.count + 1,
                },
            };
        }

        case 'INCIDENT_DELETED': {
            const notes = state.notes.notes.filter(
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                note => String(note._id) !== String(action.payload._id)
            );
            return {
                ...state,
                notes: {
                    ...state.notes,
                    notes,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type '{ error: ... Remove this comment to see the full error message
                    count: state.notes.count - 1,
                },
            };
        }

        case 'INCIDENT_UPDATED': {
            const notes = state.notes.notes.map(note => {
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                if (String(note._id) === String(action.payload._id)) {
                    // @ts-expect-error ts-migrate(2322) FIXME: Type 'any' is not assignable to type 'never'.
                    note = action.payload;
                    return note;
                }
                return note;
            });
            return {
                ...state,
                notes: {
                    ...state.notes,
                    notes,
                },
                incident: {
                    ...state.incident,
                    incident: action.payload,
                },
            };
        }

        case FUTURE_EVENTS_REQUEST:
            return {
                ...state,
                futureEvents: {
                    ...state.futureEvents,
                    requesting: true,
                    success: false,
                    error: null,
                },
                individualEvents: {
                    ...state.individualEvents,
                    show: false,
                },
            };

        case FUTURE_EVENTS_SUCCESS:
            return {
                ...state,
                futureEvents: {
                    requesting: false,
                    success: true,
                    error: null,
                    events: action.payload.data,
                    count: action.payload.count,
                    skip: action.payload.skip || 0,
                },
                individualEvents: {
                    // reset individualEvents state
                    ...INITIAL_STATE.individualEvents,
                },
            };

        case FUTURE_EVENTS_FAILURE:
            return {
                ...state,
                futureEvents: {
                    ...state.futureEvents,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case PAST_EVENTS_REQUEST:
            return {
                ...state,
                pastEvents: {
                    ...state.pastEvents,
                    requesting: true,
                    success: false,
                    error: null,
                },
                individualEvents: {
                    ...state.individualEvents,
                    show: false,
                },
            };

        case PAST_EVENTS_SUCCESS:
            return {
                ...state,
                pastEvents: {
                    requesting: false,
                    success: true,
                    error: null,
                    events: action.payload.data,
                    count: action.payload.count,
                    skip: action.payload.skip || 0,
                },
                individualEvents: {
                    // reset individualEvents state
                    ...INITIAL_STATE.individualEvents,
                },
            };

        case PAST_EVENTS_FAILURE:
            return {
                ...state,
                pastEvents: {
                    ...state.pastEvents,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case FETCH_LAST_INCIDENT_TIMELINE_REQUEST:
            return {
                ...state,
                lastIncidentTimeline: {
                    ...state.lastIncidentTimeline,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case FETCH_LAST_INCIDENT_TIMELINE_SUCCESS:
            return {
                ...state,
                lastIncidentTimeline: {
                    requesting: false,
                    success: true,
                    error: null,
                    timeline: action.payload[0],
                },
            };

        case FETCH_LAST_INCIDENT_TIMELINE_FAILURE:
            return {
                ...state,
                lastIncidentTimeline: {
                    ...state.lastIncidentTimeline,
                    success: false,
                    requesting: false,
                    error: action.payload,
                },
            };

        case FETCH_LAST_INCIDENT_TIMELINES_REQUEST:
            return {
                ...state,
                lastIncidentTimelines: {
                    ...state.lastIncidentTimelines,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case FETCH_LAST_INCIDENT_TIMELINES_SUCCESS:
            return {
                ...state,
                lastIncidentTimelines: {
                    requesting: false,
                    success: true,
                    error: null,
                    timelines: action.payload,
                },
            };

        case 'INCIDENT_TIMELINE_CREATED': {
            const timelineIds: $TSFixMe = [];
            let singleTimeline = false;
            let timelines = state.lastIncidentTimelines.timelines.map(
                timeline => {
                    if (
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentId' does not exist on type 'neve... Remove this comment to see the full error message
                        String(timeline.incidentId) ===
                        String(action.payload.incidentId)
                    ) {
                        singleTimeline = true;
                        // @ts-expect-error ts-migrate(2322) FIXME: Type 'any' is not assignable to type 'never'.
                        timeline = action.payload;
                    }
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentId' does not exist on type 'neve... Remove this comment to see the full error message
                    timelineIds.push(String(timeline.incidentId));
                    return timeline;
                }
            );
            if (
                !timelineIds.includes(String(action.payload.incidentId)) &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type '{}'.
                String(state.incident.incident._id) ===
                    String(action.payload.incidentId)
            ) {
                singleTimeline = true;
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'any' is not assignable to type 'never'.
                timelines = [...timelines, action.payload];
            }
            if (!timelineIds.includes(String(action.payload.incidentId))) {
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'any' is not assignable to type 'never'.
                timelines = [...timelines, action.payload];
            }
            const timeline =
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type '{}'.
                String(state.incident.incident._id) ===
                String(action.payload.incidentId)
                    ? action.payload
                    : { ...state.lastIncidentTimeline.timeline };
            return {
                ...state,
                lastIncidentTimelines: {
                    ...state.lastIncidentTimelines,
                    timelines,
                },
                lastIncidentTimeline: singleTimeline
                    ? {
                          ...state.lastIncidentTimeline,
                          timeline,
                      }
                    : { ...state.lastIncidentTimeline },
            };
        }

        case FETCH_LAST_INCIDENT_TIMELINES_FAILURE:
            return {
                ...state,
                lastIncidentTimelines: {
                    ...state.lastIncidentTimelines,
                    success: false,
                    requesting: false,
                    error: action.payload,
                },
            };

        case SHOW_EVENT_CARD:
            return {
                ...state,
                showEventCard: action.payload,
            };

        case TRANSLATE_LANGUAGE:
            return {
                ...state,
                language: action.payload,
            };

        case SHOW_INCIDENT_CARD:
            return {
                ...state,
                showIncidentCard: action.payload,
            };

        case CALCULATE_TIME_REQUEST:
            return {
                ...state,
                monitorInfo: {
                    ...state.monitorInfo,
                    requesting: {
                        ...state.monitorInfo.requesting,
                        [action.payload]: true,
                    },
                    success: {
                        ...state.monitorInfo.success,
                        [action.payload]: false,
                    },
                    error: null,
                },
            };

        case CALCULATE_TIME_SUCCESS:
            return {
                ...state,
                monitorInfo: {
                    requesting: {
                        ...state.monitorInfo.requesting,
                        [action.payload.monitorId]: false,
                    },
                    success: {
                        ...state.monitorInfo.success,
                        [action.payload.monitorId]: true,
                    },
                    error: null,
                    info: {
                        ...state.monitorInfo.info,
                        [action.payload.monitorId]: action.payload,
                    },
                },
            };

        case CALCULATE_TIME_FAILURE:
            return {
                ...state,
                monitorInfo: {
                    ...state.monitorInfo,
                    error: action.payload,
                },
            };
        case FETCH_TWEETS_FAILURE:
            return {
                ...state,
                tweets: {
                    ...state.tweets,
                    success: false,
                    requesting: false,
                    error: action.payload,
                },
            };

        case FETCH_TWEETS_REQUEST:
            return {
                ...state,
                tweets: {
                    ...state.tweets,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case FETCH_TWEETS_SUCCESS:
            return {
                ...state,
                tweets: {
                    requesting: false,
                    success: true,
                    error: null,
                    tweetList: action.payload,
                },
            };

        case 'UPDATE_TWEETS':
            return {
                ...state,
                tweets: {
                    requesting: false,
                    success: true,
                    error: null,
                    tweetList: action.payload,
                },
            };

        default:
            return state;

        case FETCH_EXTERNAL_STATUSPAGES_REQUEST:
            return Object.assign({}, state, {
                externalStatusPages: {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'externalStatusPages' does not exist on t... Remove this comment to see the full error message
                    ...state.externalStatusPages,
                    requesting: true,
                    success: false,
                    error: null,
                },
            });
        case FETCH_EXTERNAL_STATUSPAGES_SUCCESS:
            return Object.assign({}, state, {
                externalStatusPages: {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'cexternalStatusPages' does not exist on ... Remove this comment to see the full error message
                    ...state.cexternalStatusPages,
                    externalStatusPagesList: action.payload,
                    requesting: false,
                    success: true,
                    error: null,
                },
            });

        case FETCH_EXTERNAL_STATUSPAGES_FAILURE: {
            return Object.assign({}, state, {
                externalStatusPages: {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'externalStatusPages' does not exist on t... Remove this comment to see the full error message
                    ...state.externalStatusPages,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });
        }
    }
};
