/* eslint-disable no-console */
import {
    FETCH_MONITORS_SUCCESS,
    FETCH_MONITORS_FAILURE,
    FETCH_MONITORS_RESET,
    FETCH_MONITORS_REQUEST,
    CREATE_MONITOR_SUCCESS,
    CREATE_MONITOR_FAILURE,
    CREATE_MONITOR_RESET,
    CREATE_MONITOR_REQUEST,
    EDIT_MONITOR_SUCCESS,
    EDIT_MONITOR_FAILURE,
    EDIT_MONITOR_RESET,
    EDIT_MONITOR_REQUEST,
    EDIT_MONITOR_SWITCH,
    DELETE_MONITOR_SUCCESS,
    DELETE_MONITOR_FAILURE,
    DELETE_MONITOR_REQUEST,
    DELETE_PROJECT_MONITORS,
    FETCH_MONITORS_INCIDENT_REQUEST,
    FETCH_MONITORS_INCIDENT_SUCCESS,
    FETCH_MONITORS_INCIDENT_FAILURE,
    FETCH_MONITORS_SUBSCRIBER_REQUEST,
    FETCH_MONITORS_SUBSCRIBER_SUCCESS,
    FETCH_MONITORS_SUBSCRIBER_FAILURE,
    REMOVE_MONITORS_SUBSCRIBERS,
    FETCH_MONITOR_LOGS_REQUEST,
    FETCH_MONITOR_LOGS_SUCCESS,
    FETCH_MONITOR_LOGS_FAILURE,
    ADD_SEAT_SUCCESS,
    ADD_SEAT_FAILURE,
    ADD_SEAT_REQUEST,
    ADD_SEAT_RESET,
    SELECT_PROBE,
} from '../constants/monitor';


const INITIAL_STATE = {
    monitorsList: {
        monitors: [],
        error: null,
        requesting: false,
        success: false
    },
    newMonitor: {
        monitor: null,
        error: null,
        requesting: false,
        success: false
    },
    editMonitor: {
        error: null,
        requesting: false,
        success: false
    },
    addseat: {
        error: null,
        requesting: false,
        success: false
    },
    fetchMonitorsIncidentRequest: false,
    activeProbe: 0,
    fetchMonitorLogsRequest: false,
    fetchMonitorsSubscriberRequest: false,
    deleteMonitor: false,
};

export default function monitor(state = INITIAL_STATE, action) {
    let monitors, isExistingMonitor;
    switch (action.type) {

        case CREATE_MONITOR_SUCCESS:
            isExistingMonitor = state.monitorsList.monitors.find(monitor => monitor._id === action.payload.projectId._id);
            return Object.assign({}, state, {
                ...state,
                newMonitor: {
                    requesting: false,
                    error: null,
                    success: false,
                    monitor: null
                },
                monitorsList: {
                    ...state.monitorsList,
                    monitors: isExistingMonitor ? state.monitorsList.monitors.length > 0 ? state.monitorsList.monitors.map((subProjectMonitors) => {
                        return subProjectMonitors._id === action.payload.projectId._id ?
                            {
                                _id: action.payload.projectId._id,
                                monitors: [action.payload, ...subProjectMonitors.monitors],
                                count: subProjectMonitors.count + 1,
                                skip: subProjectMonitors.skip,
                                limit: subProjectMonitors.limit
                            }
                            : subProjectMonitors
                    }) : [{ _id: action.payload.projectId, monitors: [action.payload], count: 1, skip: 0, limit: 0 }]
                        : [{ _id: action.payload.projectId, monitors: [action.payload], count: 1, skip: 0, limit: 0 }].concat(state.monitorsList.monitors)
                }
            });

        case CREATE_MONITOR_FAILURE:
            return Object.assign({}, state, {
                ...state,
                newMonitor: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    monitor: state.newMonitor.monitor
                }
            });

        case CREATE_MONITOR_RESET:
            return Object.assign({}, state, {
                ...state,
                newMonitor: INITIAL_STATE.newMonitor
            });

        case CREATE_MONITOR_REQUEST:
            return Object.assign({}, state, {
                ...state,
                newMonitor: {
                    requesting: true,
                    error: null,
                    success: false,
                    monitor: state.newMonitor.monitor
                }
            });

        case FETCH_MONITORS_SUCCESS:
            return Object.assign({}, state, {
                ...state,

                monitorsList: {
                    requesting: false,
                    error: null,
                    success: false,
                    monitors: action.payload
                }
            });

        case FETCH_MONITORS_FAILURE:
            return Object.assign({}, state, {
                ...state,

                monitorsList: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    monitors: []
                }
            });

        case FETCH_MONITORS_RESET:
            return Object.assign({}, state, {
                ...state,
                monitorsList: INITIAL_STATE.monitorsList
            });

        case FETCH_MONITORS_REQUEST:
            return Object.assign({}, state, {
                ...state,

                monitorsList: {
                    requesting: true,
                    error: null,
                    success: false,
                    monitors: []
                }
            });

        case EDIT_MONITOR_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                monitorsList: {
                    requesting: false,
                    error: null,
                    success: false,
                    monitors: state.monitorsList.monitors.map((monitor) => {
                        monitor.monitors = monitor.monitors.map((monitor) => {
                            if (monitor._id === action.payload._id) {
                                if (!action.payload.incidents) action.payload.incidents = monitor.incidents
                                if (!action.payload.subscribers) action.payload.subscribers = monitor.subscribers
                                if (!action.payload.skip) action.payload.skip = monitor.skip
                                if (!action.payload.limit) action.payload.limit = monitor.limit
                                if (!action.payload.count) action.payload.count = monitor.count
                                return action.payload;
                            } else {
                                return monitor;
                            }
                        })
                        return monitor;
                    })
                },
                editMonitor: {
                    requesting: false,
                    error: null,
                    success: false
                }
            });

        case EDIT_MONITOR_FAILURE:
            return Object.assign({}, state, {
                ...state,
                editMonitor: {
                    requesting: false,
                    error: action.payload,
                    success: false
                }
            });

        case EDIT_MONITOR_RESET:
            return Object.assign({}, state, {
                ...state,
                editMonitor: INITIAL_STATE.editMonitor
            });

        case EDIT_MONITOR_REQUEST:
            return Object.assign({}, state, {
                ...state,
                editMonitor: {
                    requesting: true,
                    error: null,
                    success: false
                }
            });

        case EDIT_MONITOR_SWITCH:
            return Object.assign({}, state, {
                ...state,
                monitorsList: {
                    requesting: false,
                    error: null,
                    success: false,
                    monitors: state.monitorsList.monitors.map((monitor) => {
                        monitor.monitors = monitor.monitors.map((monitor, i) => {
                            if (i === action.payload || monitor._id === action.payload) {
                                if (!monitor.editMode)
                                    monitor.editMode = true;
                                else
                                    monitor.editMode = false;
                                return monitor;
                            } else {
                                monitor.editMode = false;
                                return monitor;
                            }
                        })
                        return monitor
                    })
                },
                editMonitor: {
                    requesting: false,
                    error: null,
                    success: false
                }
            });

        case FETCH_MONITORS_INCIDENT_SUCCESS:
            return Object.assign({}, state, {
                ...state,

                monitorsList: {
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        monitor.monitors = monitor._id === action.payload.projectId ? monitor.monitors.map((monitor) => {
                            if (monitor._id === action.payload.monitorId) {
                                monitor.incidents = action.payload.incidents.data;
                                monitor.skip = action.payload.skip;
                                monitor.limit = action.payload.limit;
                                monitor.count = action.payload.count;
                                return monitor
                            } else {
                                return monitor
                            }
                        }) : monitor.monitors
                        return monitor;
                    })
                },
                fetchMonitorsIncidentRequest: false
            });

        case FETCH_MONITORS_INCIDENT_FAILURE:
            return Object.assign({}, state, {
                ...state,

                monitorsList: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    monitors: state.monitorsList.monitors
                },
                fetchMonitorsIncidentRequest: false
            });

        case FETCH_MONITORS_INCIDENT_REQUEST:
            return Object.assign({}, state, {
                ...state,

                fetchMonitorsIncidentRequest: action.payload
            });

        case FETCH_MONITORS_SUBSCRIBER_SUCCESS:
            return Object.assign({}, state, {
                ...state,

                monitorsList: {
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        monitor.monitors = monitor._id === action.payload.projectId ? monitor.monitors.map((monitor) => {
                            if (monitor._id === action.payload.monitorId) {
                                monitor.subscribers = {
                                    subscribers: action.payload.subscribers.data,
                                    skip: action.payload.skip,
                                    limit: action.payload.limit,
                                    count: action.payload.count,
                                }
                                return monitor
                            } else {
                                return monitor
                            }
                        }) : monitor.monitors
                        return monitor;
                    })
                },
                fetchMonitorsSubscriberRequest: false
            });

        case FETCH_MONITORS_SUBSCRIBER_FAILURE:
            return Object.assign({}, state, {
                ...state,

                monitorsList: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    monitors: []
                },
                fetchMonitorsSubscriberRequest: false
            });

        case FETCH_MONITORS_SUBSCRIBER_REQUEST:
            return Object.assign({}, state, {
                ...state,

                fetchMonitorsSubscriberRequest: action.payload
            });

        case FETCH_MONITOR_LOGS_REQUEST:
            return Object.assign({}, state, {
                ...state,

                fetchMonitorLogsRequest: action.payload
            });

        case FETCH_MONITOR_LOGS_SUCCESS:
            return Object.assign({}, state, {
                ...state,

                monitorsList: {
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        monitor.monitors = monitor._id === action.payload.projectId ? monitor.monitors.map((monitor) => {
                            if (monitor._id === action.payload.monitorId) {
                                monitor.logs = action.payload.logs.data;
                                return monitor
                            } else {
                                return monitor
                            }
                        }) : monitor.monitors
                        return monitor;
                    })
                },
                fetchMonitorLogsRequest: false
            });

        case FETCH_MONITOR_LOGS_FAILURE:
            return Object.assign({}, state, {
                ...state,

                monitorsList: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    monitors: state.monitorsList.monitors
                },
                fetchMonitorLogsRequest: false
            });

        case REMOVE_MONITORS_SUBSCRIBERS:
            return Object.assign({}, state, {
                ...state,
                monitorsList: {
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        if (monitor._id === action.payload.monitorId) {
                            monitor.subscribers.subscribers = monitor.subscribers.subscribers.filter(subscriber => subscriber._id !== action.payload._id)
                            monitor.subscribers.count = monitor.subscribers.count - 1
                            return monitor;
                        } else {
                            return monitor;
                        }
                    })
                }
            })

        case DELETE_MONITOR_SUCCESS:
            return Object.assign({}, state, {
                ...state,

                monitorsList: {
                    requesting: false,
                    error: null,
                    success: false,
                    monitors: state.monitorsList.monitors.map((subProjectMonitor) => {
                        subProjectMonitor.monitors = subProjectMonitor.monitors.filter(({ _id }) => _id !== action.payload);
                        return subProjectMonitor;
                    }),
                },
                deleteMonitor: false,
            });

        case DELETE_MONITOR_FAILURE:
            return Object.assign({}, state, {
                ...state,

                monitorsList: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    monitors: [...state.monitorsList.monitors],
                },
                deleteMonitor: false,
            });

        case DELETE_MONITOR_REQUEST:
            return Object.assign({}, state, {
                ...state,

                monitorsList: {
                    requesting: false,
                    error: null,
                    success: false,
                    monitors: [...state.monitorsList.monitors]
                },
                deleteMonitor: action.payload,
            });

        case DELETE_PROJECT_MONITORS:
            monitors = Object.assign([], state.monitorsList.monitors);
            monitors = monitors.filter(monitor => action.payload !== monitor.projectId);

            return Object.assign({}, state, {
                monitorsList: {
                    monitors,
                    error: null,
                    loading: false
                },
            });

        case 'RESOLVE_INCIDENT_SUCCESS':
            return Object.assign({}, state, {
                ...state,

                monitorsList: {
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        monitor.monitors = monitor._id === action.payload.projectId ? monitor.monitors.map((monitor) => {
                            monitor.incidents = monitor.incidents ? monitor.incidents.map(incident => {
                                if (incident._id === action.payload._id) {
                                    return action.payload;
                                }
                                else {
                                    return incident;
                                }
                            }) : [action.payload];
                            return monitor
                        }) : monitor.monitors
                        return monitor;
                    })
                }
            });

        case 'ACKNOWLEDGE_INCIDENT_SUCCESS':
            return Object.assign({}, state, {
                ...state,

                monitorsList: {
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        monitor.monitors = monitor._id === action.payload.projectId ? monitor.monitors.map((monitor) => {
                            monitor.incidents = monitor.incidents ? monitor.incidents.map(incident => {
                                if (incident._id === action.payload._id) {
                                    return action.payload;
                                }
                                else {
                                    return incident;
                                }
                            }) : [action.payload]
                            return monitor
                        }) : monitor.monitors
                        return monitor;
                    })
                }
            });

        case 'INCIDENT_RESOLVED_BY_SOCKET':
            return Object.assign({}, state, {
                ...state,

                monitorsList: {
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        monitor.monitors = monitor._id === action.payload.projectId ? monitor.monitors.map((monitor) => {
                            monitor.incidents = monitor.incidents ? monitor.incidents.map(incident => {
                                if (incident._id === action.payload.data._id) {
                                    return action.payload.data;
                                }
                                else {
                                    return incident;
                                }
                            }) : [action.payload.data];
                            return monitor
                        }) : monitor.monitors
                        return monitor;
                    })
                }
            });

        case 'INCIDENT_ACKNOWLEDGED_BY_SOCKET':
            return Object.assign({}, state, {
                ...state,

                monitorsList: {
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        monitor.monitors = monitor._id === action.payload.projectId ? monitor.monitors.map((monitor) => {
                            monitor.incidents = monitor.incidents ? monitor.incidents.map(incident => {
                                if (incident._id === action.payload.data._id) {
                                    return action.payload.data;
                                }
                                else {
                                    return incident;
                                }
                            }) : [action.payload.data]
                            return monitor
                        }) : monitor.monitors
                        return monitor;
                    }),
                }
            });

        case 'DELETE_MONITOR_BY_SOCKET':
            return Object.assign({}, state, {
                ...state,
                monitorsList: {
                    requesting: false,
                    error: null,
                    success: false,
                    monitors: state.monitorsList.monitors.map((subProjectMonitor) => {
                        subProjectMonitor.monitors = subProjectMonitor.monitors.filter(({ _id }) => _id !== action.payload);
                        return subProjectMonitor;
                    }),
                },

            });

        case 'ADD_NEW_INCIDENT_TO_MONITORS':
            return Object.assign({}, state, {
                ...state,
                monitorsList: {
                    ...state.monitorsList,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        monitor.monitors = monitor._id === action.payload.projectId ? monitor.monitors.map((monitor) => {
                            if (monitor._id === action.payload.monitorId._id) {
                                var incidents = monitor.incidents || [];

                                if (incidents && incidents.length) {
                                    if (incidents.length > 2) {
                                        incidents.splice(-1, 1);
                                    }
                                    incidents.unshift(action.payload);
                                }
                                return {
                                    ...monitor,
                                    incidents: incidents
                                };
                            } else {
                                return monitor;
                            }
                        }) : monitor.monitors
                        return monitor;
                    }),
                },

            });

        case 'UPDATE_RESPONSE_TIME':
            return Object.assign({}, state, {
                ...state,
                monitorsList: {
                    ...state.monitorsList,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        if (monitor._id === action.payload.monitorId) {
                            return {
                                ...monitor,
                                responseTime: action.payload.time,
                                status: action.payload.status
                            };
                        } else {
                            return monitor;
                        }
                    }),
                },

            });

        case ADD_SEAT_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                addseat: {
                    requesting: false,
                    error: null,
                    success: action.payload
                },

            });

        case ADD_SEAT_FAILURE:
            return Object.assign({}, state, {
                ...state,
                addseat: {
                    requesting: false,
                    error: action.payload,
                    success: false
                },

            });

        case ADD_SEAT_REQUEST:
            return Object.assign({}, state, {
                ...state,
                addseat: {
                    requesting: true,
                    error: null,
                    success: false
                },

            });

        case ADD_SEAT_RESET:
            return Object.assign({}, state, {
                ...state,
                addseat: {
                    requesting: false,
                    error: null,
                    success: false
                },

            });

        case SELECT_PROBE:
            return Object.assign({}, state, {
                activeProbe: action.payload
            });

        default: return state;
    }
}
