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
    MORE_EVENTS_REQUEST,
    MORE_EVENTS_SUCCESS,
    MORE_EVENTS_FAILURE,
    SCHEDULED_EVENTS_RESET,
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
} from '../constants/status';
import moment from 'moment';

const INITIAL_STATE = {
    error: null,
    statusPage: {},
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
};

export default (state = INITIAL_STATE, action) => {
    switch (action.type) {
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
                    monitor => monitor._id === state.individualnote._id
                );
            return Object.assign({}, state, {
                error: null,
                statusPage: {
                    ...action.payload,

                    monitorsData:
                        action.payload.monitorsData &&
                        action.payload.monitorsData.length > 0
                            ? action.payload.monitorsData.map(
                                  newMonitorData => {
                                      if (
                                          state.statusPage.monitorsData &&
                                          state.statusPage.monitorsData.length >
                                              0
                                      ) {
                                          state.statusPage.monitorsData.forEach(
                                              oldMonitorData => {
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
                        state.statusPage.monitorIds &&
                        state.statusPage.monitorIds.length > 0
                            ? state.statusPage.monitorIds.map(monitor => {
                                  if (monitor._id === action.payload._id) {
                                      monitor.name = action.payload.name;
                                  }
                                  return monitor;
                              })
                            : [],
                    monitorsData:
                        state.statusPage.monitorsData &&
                        state.statusPage.monitorsData.length > 0
                            ? state.statusPage.monitorsData.map(monitor => {
                                  if (monitor._id === action.payload._id) {
                                      return {
                                          ...monitor,
                                          ...action.payload,
                                          monitorCategoryId:
                                              action.payload.monitorCategoryId,
                                      };
                                  }
                                  return monitor;
                              })
                            : [],
                },
                requesting: false,
            });

        case 'DELETE_MONITOR': {
            const isIndividualNote =
                state.individualnote &&
                state.individualnote._id === action.payload;
            return Object.assign({}, state, {
                error: null,
                statusPage: {
                    ...state.statusPage,

                    monitorIds:
                        state.statusPage.monitorIds &&
                        state.statusPage.monitorIds.length > 0
                            ? state.statusPage.monitorIds.filter(
                                  monitor => monitor._id !== action.payload
                              )
                            : [],
                    monitorsData:
                        state.statusPage.monitorsData &&
                        state.statusPage.monitorsData.length > 0
                            ? state.statusPage.monitorsData.filter(
                                  monitor => monitor._id !== action.payload
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
            let notes = [...state.incidentNotes.notes],
                noteData = state.notes.notes,
                result = [];
            const check = noteData.find(
                note =>
                    String(note._id) === String(action.payload.incidentId._id)
            );
            if (
                String(state.incident.incident._id) ===
                String(action.payload.incidentId._id)
            ) {
                addToIncident = true;
                notes = [action.payload, ...notes];
            }
            if (check && noteData) {
                let oneNote;
                noteData.forEach(item => {
                    if (
                        String(item._id) ===
                        String(action.payload.incidentId._id)
                    ) {
                        const messageLog =
                            item.message && item.message.length > 0
                                ? item.message
                                : [];
                        oneNote = {
                            ...item,
                            message: [action.payload, ...messageLog],
                        };
                    }
                });
                noteData.forEach(elem => {
                    if (String(elem._id) === String(oneNote._id)) {
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
                String(state.incident.incident._id) ===
                String(action.payload.incidentId._id)
            ) {
                notes = state.incidentNotes.notes.map(note => {
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
                        : state.notes.count,
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

        case 'ADD_SCHEDULED_EVENT': {
            let monitorInStatusPage = false;
            let addEvent = false;
            let addFutureEvent = false;
            state.statusPage.monitors.map(monitorData => {
                action.payload.monitors.map(monitor => {
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
                    event => String(event._id) !== String(action.payload._id)
                );
            } else {
                events = state.events.events.filter(
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

            state.statusPage.monitors.map(monitorData => {
                action.payload.monitors.map(monitor => {
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
                if (String(event._id) === String(action.payload._id)) {
                    eventExist = true;
                    event = action.payload;
                }
                return event;
            });

            const updatedFutureEvent = state.futureEvents.events.map(event => {
                if (String(event._id) === String(action.payload._id)) {
                    futureEventExist = true;
                    event = action.payload;
                }
                return event;
            });

            if (!eventExist) {
                updatedEvents.unshift(action.payload);
            }

            if (!futureEventExist) {
                updatedFutureEvent.unshift(action.payload);
            }

            const removeEvent = state.events.events.filter(
                event => String(event._id) !== String(action.payload._id)
            );

            const removeFutureEvent = state.futureEvents.events.filter(
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
            });

        case FETCH_MONITOR_STATUSES_SUCCESS:
            return Object.assign({}, state, {
                statusPage: {
                    ...state.statusPage,

                    monitorsData: state.statusPage.monitorsData.map(monitor => {
                        if (monitor._id === action.payload.monitorId) {
                            monitor.statuses = action.payload.statuses.data;
                        }
                        return monitor;
                    }),
                },
                requestingstatuses: false,
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

                    monitorsData: state.statusPage.monitorsData.map(monitor => {
                        if (monitor._id === action.payload.status.monitorId) {
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
                                    a => a._id
                                );

                                if (
                                    monitorProbes.includes(data.probeId) ||
                                    !data.probeId
                                ) {
                                    monitor.statuses = monitor.statuses.map(
                                        probeStatuses => {
                                            const probeId = probeStatuses._id;

                                            if (
                                                probeId === data.probeId ||
                                                !data.probeId
                                            ) {
                                                const previousStatus =
                                                    probeStatuses.statuses[0];
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
                                        !probes.every(probe =>
                                            monitorProbes.includes(probe._id)
                                        )
                                    ) {
                                        // add manual status to all new probes
                                        const newProbeStatuses = [];

                                        probes.forEach(probe => {
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
                                        });

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
                                    monitor.statuses = probes.map(probe => ({
                                        _id: probe._id,
                                        statuses: [data],
                                    }));
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
                    }),
                },
                requestingstatuses: false,
            });

        case FETCH_MONITOR_LOGS_REQUEST:
            return Object.assign({}, state, {
                logs: state.logs.some(log => log.monitorId === action.payload)
                    ? state.logs.map(log =>
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
                String(state.scheduledEvent.event._id) ===
                String(action.payload.scheduledEventId._id)
            ) {
                increaseCount = true;
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
                String(state.scheduledEvent.event._id) ===
                String(action.payload.scheduledEventId._id)
            ) {
                reduceCount = true;
                eventNotes = state.eventNoteList.eventNotes.filter(
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
                String(state.scheduledEvent.event._id) ===
                String(action.payload.scheduledEventId._id)
            ) {
                eventNotes = state.eventNoteList.eventNotes.map(note => {
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
            const statusPageMonitorIds = state.statusPage.monitors.map(
                monitorData => String(monitorData.monitor._id)
            );
            let notes = state.notes.notes.map(note => {
                if (String(note._id) === String(action.payload._id)) {
                    incidentFound = true;
                }
                return note;
            });
            if (
                !incidentFound &&
                statusPageMonitorIds.includes(
                    String(action.payload.monitorId._id)
                )
            ) {
                notes = [action.payload, ...notes];
            }
            return {
                ...state,
                notes: {
                    ...state.notes,
                    notes,
                    count: incidentFound
                        ? state.notes.count
                        : state.notes.count + 1,
                },
            };
        }

        case 'INCIDENT_DELETED': {
            const notes = state.notes.notes.filter(
                note => String(note._id) !== String(action.payload._id)
            );
            return {
                ...state,
                notes: {
                    ...state.notes,
                    notes,
                    count: state.notes.count - 1,
                },
            };
        }

        case 'INCIDENT_UPDATED': {
            const notes = state.notes.notes.map(note => {
                if (String(note._id) === String(action.payload._id)) {
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
            const timelineIds = [];
            let singleTimeline = false;
            let timelines = state.lastIncidentTimelines.timelines.map(
                timeline => {
                    if (
                        String(timeline.incidentId) ===
                        String(action.payload.incidentId)
                    ) {
                        singleTimeline = true;
                        timeline = action.payload;
                    }
                    timelineIds.push(String(timeline.incidentId));
                    return timeline;
                }
            );
            if (
                !timelineIds.includes(String(action.payload.incidentId)) &&
                String(state.incident.incident._id) ===
                    String(action.payload.incidentId)
            ) {
                singleTimeline = true;
                timelines = [...timelines, action.payload];
            }
            if (!timelineIds.includes(String(action.payload.incidentId))) {
                timelines = [...timelines, action.payload];
            }
            const timeline =
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

        case SHOW_INCIDENT_CARD:
            return {
                ...state,
                showIncidentCard: action.payload,
            };

        default:
            return state;
    }
};
