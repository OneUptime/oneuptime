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
    FETCH_MONITOR_STATUSES_REQUEST,
    FETCH_MONITOR_STATUSES_SUCCESS,
    FETCH_MONITOR_STATUSES_FAILURE,
    FETCH_LIGHTHOUSE_LOGS_REQUEST,
    FETCH_LIGHTHOUSE_LOGS_SUCCESS,
    FETCH_LIGHTHOUSE_LOGS_FAILURE,
    FETCH_MONITOR_ISSUE_REQUEST,
    FETCH_MONITOR_ISSUE_SUCCESS,
    FETCH_MONITOR_ISSUE_FAILURE,
    FETCH_MONITOR_CRITERIA_REQUEST,
    FETCH_MONITOR_CRITERIA_SUCCESS,
    FETCH_MONITOR_CRITERIA_FAILURE,
    SET_MONITOR_CRITERIA,
    ADD_SEAT_SUCCESS,
    ADD_SEAT_FAILURE,
    ADD_SEAT_REQUEST,
    ADD_SEAT_RESET,
    SELECT_PROBE,
    GET_MONITOR_LOGS_REQUEST,
    GET_MONITOR_LOGS_SUCCESS,
    GET_MONITOR_LOGS_FAILURE,
    GET_MONITOR_LOGS_RESET,
    TOGGLE_EDIT,
    FETCH_BREACHED_MONITOR_SLA_FAILURE,
    FETCH_BREACHED_MONITOR_SLA_REQUEST,
    FETCH_BREACHED_MONITOR_SLA_SUCCESS,
    CLOSE_BREACHED_MONITOR_SLA_FAILURE,
    CLOSE_BREACHED_MONITOR_SLA_REQUEST,
    CLOSE_BREACHED_MONITOR_SLA_SUCCESS,
    DISABLE_MONITOR_SUCCESS,
    DISABLE_MONITOR_FAILURE,
    DISABLE_MONITOR_REQUEST,
    UPLOAD_IDENTITY_FILE_REQUEST,
    UPLOAD_IDENTITY_FILE_SUCCESS,
    RESET_UPLOAD_IDENTITY_FILE,
    UPLOAD_CONFIGURATION_FILE_REQUEST,
    UPLOAD_CONFIGURATION_FILE_SUCCESS,
    RESET_UPLOAD_CONFIGURATION_FILE,
    SET_CONFIGURATION_FILE_INPUT_KEY,
    CHANGE_MONITOR_COMPONENT_FAILURE,
    CHANGE_MONITOR_COMPONENT_SUCCESS,
    CHANGE_MONITOR_COMPONENT_REQUEST,
    FETCH_PAGINATED_MONITORS_FAILURE,
    FETCH_PAGINATED_MONITORS_REQUEST,
    FETCH_PAGINATED_MONITORS_SUCCESS,
} from '../constants/monitor';
import moment from 'moment';

const INITIAL_STATE = {
    monitorsList: {
        monitors: [],
        error: null,
        requesting: false,
        success: false,
        startDate: moment().subtract(30, 'd'),
        endDate: moment(),
        editMode: false,
    },
    paginatedMonitorsList: {
        monitors: [],
        error: null,
        requesting: false,
        success: false,
        startDate: moment().subtract(30, 'd'),
        endDate: moment(),
        editMode: false,
    },
    monitorIssue: null,
    monitorLogs: {},
    newMonitor: {
        monitor: null,
        error: null,
        requesting: false,
        success: false,
        initialValue: null,
    },
    monitorCriteria: {
        criteria: null,
        error: null,
        requesting: false,
        success: false,
    },
    editMonitor: {
        error: null,
        requesting: false,
        success: false,
    },
    addseat: {
        error: null,
        requesting: false,
        success: false,
    },
    fetchMonitorsIncidentRequest: false,
    activeProbe: 0,
    fetchMonitorLogsRequest: false,
    monitorLogsRequest: {},
    fetchMonitorStatusesRequest: false,
    fetchLighthouseLogsRequest: false,
    fetchMonitorCriteriaRequest: false,
    fetchMonitorsSubscriberRequest: false,
    deleteMonitor: false,
    disableMonitor: false,
    changeMonitorComponent: {
        newComponentId: null,
        error: null,
        requesting: false,
        success: false,
    },
    monitorSlaBreaches: {
        requesting: false,
        error: null,
        success: false,
        slaBreaches: [],
    },
    closeBreachedMonitorSla: {
        requesting: false,
        success: false,
        error: null,
    },
    file: null,
    fileInputKey: null,
    uploadFileRequest: false,
    configFile: null,
    uploadConfigRequest: false,
    configFileInputKey: null,
};

export default function monitor(state = INITIAL_STATE, action: $TSFixMe) {
    let monitors, monitorType, initialValue;
    switch (action.type) {
        case CREATE_MONITOR_FAILURE:
            return Object.assign({}, state, {
                newMonitor: {
                    ...state.newMonitor,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case CREATE_MONITOR_RESET:
            return Object.assign({}, state, {
                newMonitor: INITIAL_STATE.newMonitor,
            });

        case CREATE_MONITOR_REQUEST:
            return Object.assign({}, state, {
                newMonitor: {
                    ...state.newMonitor,
                    requesting: true,
                },
            });

        case TOGGLE_EDIT:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    editMode: action.payload,
                },
            });

        case UPLOAD_IDENTITY_FILE_REQUEST:
            return Object.assign({}, state, {
                uploadFileRequest: true,
            });

        case UPLOAD_IDENTITY_FILE_SUCCESS:
            return Object.assign({}, state, {
                file: action.payload,
                uploadFileRequest: false,
            });

        case RESET_UPLOAD_IDENTITY_FILE:
            return Object.assign({}, state, {
                file: null,
                uploadFileRequest: false,
            });

        case 'SET_IDENTITY_FILE_INPUT_KEY':
            return Object.assign({}, state, {
                fileInputKey: action.payload,
            });

        case SET_CONFIGURATION_FILE_INPUT_KEY:
            return {
                ...state,
                configFileInputKey: action.payload,
            };

        case UPLOAD_CONFIGURATION_FILE_REQUEST:
            return {
                ...state,
                uploadConfigRequest: true,
            };

        case UPLOAD_CONFIGURATION_FILE_SUCCESS:
            return {
                ...state,
                configFile: action.payload,
                uploadConfigRequest: false,
            };

        case RESET_UPLOAD_CONFIGURATION_FILE:
            return {
                ...state,
                configFile: null,
                uploadConfigRequest: false,
            };

        case CREATE_MONITOR_SUCCESS:
        case 'CREATE_MONITOR': {
            let monitorFound = false;
            const monitors = state.monitorsList.monitors.map(monitorData => {
                let output = {
                    // @ts-expect-error ts-migrate(2698) FIXME: Spread types may only be created from object types... Remove this comment to see the full error message
                    ...monitorData,
                    monitors: monitorData.monitors.map(monitor => {
                        if (
                            String(monitor._id) === String(action.payload._id)
                        ) {
                            monitorFound = true;
                            return action.payload;
                        }
                        return monitor;
                    }),
                };
                if (!monitorFound) {
                    output = {
                        ...output,
                        monitors: [action.payload, ...output.monitors],
                        count: output.count + 1,
                    };
                }

                return output;
            });

            return {
                ...state,
                monitorsList: {
                    ...state.monitorsList,
                    monitors,
                },
                newMonitor: {
                    requesting: false,
                    error: null,
                    success: false,
                    monitor: null,
                },
            };
        }

        case FETCH_MONITORS_SUCCESS:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: action.payload,
                },
            });

        case FETCH_PAGINATED_MONITORS_SUCCESS: {
            return Object.assign({}, state, {
                paginatedMonitorsList: {
                    ...state.paginatedMonitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: [action.payload],
                    requestingNextPage: false,
                },
            });
        }

        case FETCH_MONITORS_FAILURE:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case FETCH_PAGINATED_MONITORS_FAILURE:
            return Object.assign({}, state, {
                paginatedMonitorsList: {
                    ...state.paginatedMonitorsList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                    requestingNextPage: false,
                },
            });

        case FETCH_MONITORS_RESET:
            return Object.assign({}, state, {
                monitorsList: INITIAL_STATE.monitorsList,
            });

        case FETCH_MONITORS_REQUEST:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case FETCH_PAGINATED_MONITORS_REQUEST:
            return Object.assign({}, state, {
                paginatedMonitorsList: {
                    ...state.paginatedMonitorsList,
                    requesting: action.payload ? false : true,
                    error: null,
                    success: false,
                    requestingNextPage: true,
                },
            });

        case EDIT_MONITOR_SUCCESS:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: false,
                    monitors: state.monitorsList.monitors.map(project => {
                        const subProject = Object.assign({}, project);
                        const subProjectMonitors =
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                            subProject.monitors && subProject.monitors.slice();

                        const newMonitor = Object.assign({}, action.payload);

                        const monitorIndex =
                            subProjectMonitors &&
                            subProjectMonitors.findIndex(
                                (monitor: $TSFixMe) =>
                                    monitor._id === newMonitor._id
                            );
                        const isSubProjectMonitor = monitorIndex > -1;

                        // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                        if (subProject._id === newMonitor.projectId) {
                            if (isSubProjectMonitor) {
                                const oldMonitor = Object.assign(
                                    {},
                                    subProjectMonitors[monitorIndex]
                                );

                                if (!newMonitor.logs)
                                    newMonitor.logs = oldMonitor.logs;
                                if (!newMonitor.statuses)
                                    newMonitor.statuses = oldMonitor.statuses;
                                if (!newMonitor.currentLighthouseLog) {
                                    newMonitor.currentLighthouseLog =
                                        oldMonitor.currentLighthouseLog;
                                }
                                if (!newMonitor.lighthouseLogs)
                                    newMonitor.lighthouseLogs =
                                        oldMonitor.lighthouseLogs;
                                if (!newMonitor.incidents)
                                    newMonitor.incidents = oldMonitor.incidents;
                                if (!newMonitor.subscribers)
                                    newMonitor.subscribers =
                                        oldMonitor.subscribers;
                                if (!newMonitor.skip)
                                    newMonitor.skip = oldMonitor.skip;
                                if (!newMonitor.limit)
                                    newMonitor.limit = oldMonitor.limit;
                                if (!newMonitor.count)
                                    newMonitor.count = oldMonitor.count;

                                subProjectMonitors[monitorIndex] = newMonitor;
                            } else {
                                newMonitor.skip = 0;
                                newMonitor.limit = 0;
                                newMonitor.count = 0;

                                subProjectMonitors.unshift(newMonitor);
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'never'.
                                subProject.count += 1;
                            }
                        } else {
                            if (isSubProjectMonitor) {
                                subProjectMonitors.splice(monitorIndex, 1);
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'never'.
                                subProject.count -= 1;
                            }
                        }

                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                        subProject.monitors = subProjectMonitors;
                        return subProject;
                    }),
                },
                editMonitor: {
                    requesting: false,
                    error: null,
                    success: false,
                },
            });

        case EDIT_MONITOR_FAILURE:
            return Object.assign({}, state, {
                editMonitor: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case EDIT_MONITOR_RESET:
            return Object.assign({}, state, {
                editMonitor: INITIAL_STATE.editMonitor,
            });

        case EDIT_MONITOR_REQUEST:
            return Object.assign({}, state, {
                editMonitor: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case EDIT_MONITOR_SWITCH:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: false,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                        monitor.monitors = monitor.monitors.map(
                            (monitor: $TSFixMe, i: $TSFixMe) => {
                                if (
                                    i === action.payload ||
                                    monitor._id === action.payload
                                ) {
                                    if (!monitor.editMode)
                                        monitor.editMode = true;
                                    else monitor.editMode = false;
                                    return monitor;
                                } else {
                                    monitor.editMode = false;
                                    return monitor;
                                }
                            }
                        );
                        return monitor;
                    }),
                },
                editMonitor: {
                    requesting: false,
                    error: null,
                    success: false,
                },
            });

        case FETCH_MONITORS_INCIDENT_SUCCESS:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                        monitor.monitors =
                            // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                            monitor._id === action.payload.projectId
                                ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors.map((monitor: $TSFixMe) => {
                                      if (
                                          monitor._id ===
                                          action.payload.monitorId
                                      ) {
                                          monitor.incidents =
                                              action.payload.incidents.data;
                                          monitor.skip = action.payload.skip;
                                          monitor.limit = action.payload.limit;
                                          monitor.count = action.payload.count;
                                          return monitor;
                                      } else {
                                          return monitor;
                                      }
                                  })
                                : // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors;
                        return monitor;
                    }),
                },
                paginatedMonitorsList: {
                    ...state.paginatedMonitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.paginatedMonitorsList.monitors.map(
                        monitor => {
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                            monitor.monitors =
                                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                                monitor._id === action.payload.projectId
                                    ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                      monitor.monitors.map(
                                          (monitor: $TSFixMe) => {
                                              if (
                                                  monitor._id ===
                                                  action.payload.monitorId
                                              ) {
                                                  monitor.incidents =
                                                      action.payload.incidents.data;
                                                  monitor.skip =
                                                      action.payload.skip;
                                                  monitor.limit =
                                                      action.payload.limit;
                                                  monitor.count =
                                                      action.payload.count;
                                                  return monitor;
                                              } else {
                                                  return monitor;
                                              }
                                          }
                                      )
                                    : // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                      monitor.monitors;
                            return monitor;
                        }
                    ),
                },
                fetchMonitorsIncidentRequest: false,
            });

        case FETCH_MONITORS_INCIDENT_FAILURE:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
                paginatedMonitorsList: {
                    ...state.paginatedMonitorsList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
                fetchMonitorsIncidentRequest: false,
            });

        case FETCH_MONITORS_INCIDENT_REQUEST:
            return Object.assign({}, state, {
                fetchMonitorsIncidentRequest: action.payload,
            });

        case FETCH_MONITORS_SUBSCRIBER_SUCCESS:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                        monitor.monitors =
                            // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                            monitor._id === action.payload.projectId
                                ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors.map((monitor: $TSFixMe) => {
                                      if (
                                          monitor._id ===
                                          action.payload.monitorId
                                      ) {
                                          monitor.subscribers = {
                                              subscribers:
                                                  action.payload.subscribers
                                                      .data,
                                              skip: action.payload.skip,
                                              limit: action.payload.limit,
                                              count: action.payload.count,
                                          };
                                          return monitor;
                                      } else {
                                          return monitor;
                                      }
                                  })
                                : // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors;
                        return monitor;
                    }),
                },
                fetchMonitorsSubscriberRequest: false,
            });

        case FETCH_MONITORS_SUBSCRIBER_FAILURE:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
                fetchMonitorsSubscriberRequest: false,
            });

        case FETCH_MONITORS_SUBSCRIBER_REQUEST:
            return Object.assign({}, state, {
                fetchMonitorsSubscriberRequest: action.payload,
            });

        case FETCH_MONITOR_LOGS_REQUEST:
            return Object.assign({}, state, {
                fetchMonitorLogsRequest: true,
                monitorLogsRequest: {
                    [action.payload]: true,
                },
            });

        case FETCH_MONITOR_LOGS_SUCCESS:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                        monitor.monitors =
                            // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                            monitor._id === action.payload.projectId
                                ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors.map((monitor: $TSFixMe) => {
                                      if (
                                          monitor._id ===
                                          action.payload.monitorId
                                      ) {
                                          monitor.logs =
                                              action.payload.logs.data;
                                          return monitor;
                                      } else {
                                          return monitor;
                                      }
                                  })
                                : // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors;
                        return monitor;
                    }),
                },
                paginatedMonitorsList: {
                    ...state.paginatedMonitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.paginatedMonitorsList.monitors.map(
                        monitor => {
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                            monitor.monitors =
                                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                                monitor._id === action.payload.projectId
                                    ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                      monitor.monitors.map(
                                          (monitor: $TSFixMe) => {
                                              if (
                                                  monitor._id ===
                                                  action.payload.monitorId
                                              ) {
                                                  monitor.logs =
                                                      action.payload.logs.data;
                                                  return monitor;
                                              } else {
                                                  return monitor;
                                              }
                                          }
                                      )
                                    : // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                      monitor.monitors;
                            return monitor;
                        }
                    ),
                },
                fetchMonitorLogsRequest: false,
                monitorLogsRequest: {
                    ...state.monitorLogsRequest,
                    [action.payload.monitorId]: false,
                },
            });

        case FETCH_MONITOR_LOGS_FAILURE:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
                paginatedMonitorsList: {
                    ...state.paginatedMonitorsList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
                fetchMonitorLogsRequest: false,
            });

        case FETCH_MONITOR_STATUSES_REQUEST:
            return Object.assign({}, state, {
                fetchMonitorStatusesRequest: true,
            });

        case FETCH_MONITOR_STATUSES_SUCCESS:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                        monitor.monitors =
                            // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                            monitor._id === action.payload.projectId
                                ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors.map((monitor: $TSFixMe) => {
                                      if (
                                          monitor._id ===
                                          action.payload.monitorId
                                      ) {
                                          monitor.statuses =
                                              action.payload.statuses.data;
                                          return monitor;
                                      } else {
                                          return monitor;
                                      }
                                  })
                                : // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors;
                        return monitor;
                    }),
                },
                paginatedMonitorsList: {
                    ...state.paginatedMonitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.paginatedMonitorsList.monitors.map(
                        monitor => {
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                            monitor.monitors =
                                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                                monitor._id === action.payload.projectId
                                    ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                      monitor.monitors.map(
                                          (monitor: $TSFixMe) => {
                                              if (
                                                  monitor._id ===
                                                  action.payload.monitorId
                                              ) {
                                                  monitor.statuses =
                                                      action.payload.statuses.data;
                                                  return monitor;
                                              } else {
                                                  return monitor;
                                              }
                                          }
                                      )
                                    : // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                      monitor.monitors;
                            return monitor;
                        }
                    ),
                },
                fetchMonitorStatusesRequest: false,
            });

        case FETCH_MONITOR_STATUSES_FAILURE:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
                paginatedMonitorsList: {
                    ...state.paginatedMonitorsList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
                fetchMonitorStatusesRequest: false,
            });

        case FETCH_LIGHTHOUSE_LOGS_REQUEST:
            return Object.assign({}, state, {
                fetchLighthouseLogsRequest: true,
            });
        case FETCH_LIGHTHOUSE_LOGS_SUCCESS:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                        monitor.monitors =
                            // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                            monitor._id === action.payload.projectId
                                ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors.map((monitor: $TSFixMe) => {
                                      if (
                                          monitor._id ===
                                          action.payload.monitorId
                                      ) {
                                          const mainSiteUrlLogs = action.payload.logs.data.filter(
                                              (log: $TSFixMe) =>
                                                  monitor.data &&
                                                  monitor.data.url === log.url
                                          );
                                          if (
                                              mainSiteUrlLogs &&
                                              mainSiteUrlLogs.length > 0
                                          ) {
                                              monitor.currentLighthouseLog =
                                                  mainSiteUrlLogs[0];
                                          }
                                          monitor.lighthouseLogs = {
                                              data: action.payload.logs.data,
                                              skip: action.payload.skip,
                                              limit: action.payload.limit,
                                              count: action.payload.count,
                                          };
                                          return monitor;
                                      } else {
                                          return monitor;
                                      }
                                  })
                                : // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors;
                        return monitor;
                    }),
                },
                paginatedMonitorsList: {
                    ...state.paginatedMonitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.paginatedMonitorsList.monitors.map(
                        monitor => {
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                            monitor.monitors =
                                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                                monitor._id === action.payload.projectId
                                    ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                      monitor.monitors.map(
                                          (monitor: $TSFixMe) => {
                                              if (
                                                  monitor._id ===
                                                  action.payload.monitorId
                                              ) {
                                                  const mainSiteUrlLogs = action.payload.logs.data.filter(
                                                      (log: $TSFixMe) =>
                                                          monitor.data &&
                                                          monitor.data.url ===
                                                              log.url
                                                  );
                                                  if (
                                                      mainSiteUrlLogs &&
                                                      mainSiteUrlLogs.length > 0
                                                  ) {
                                                      monitor.currentLighthouseLog =
                                                          mainSiteUrlLogs[0];
                                                  }
                                                  monitor.lighthouseLogs = {
                                                      data:
                                                          action.payload.logs
                                                              .data,
                                                      skip: action.payload.skip,
                                                      limit:
                                                          action.payload.limit,
                                                      count:
                                                          action.payload.count,
                                                  };
                                                  return monitor;
                                              } else {
                                                  return monitor;
                                              }
                                          }
                                      )
                                    : // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                      monitor.monitors;
                            return monitor;
                        }
                    ),
                },
                fetchLighthouseLogsRequest: false,
            });

        case FETCH_LIGHTHOUSE_LOGS_FAILURE:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
                paginatedMonitorsList: {
                    ...state.paginatedMonitorsList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
                fetchLighthouseLogsRequest: false,
            });

        case FETCH_MONITOR_ISSUE_REQUEST:
            return Object.assign({}, state, {
                monitorIssue: null,
            });

        case FETCH_MONITOR_ISSUE_SUCCESS:
            return Object.assign({}, state, {
                monitorIssue: action.payload,
            });

        case FETCH_MONITOR_ISSUE_FAILURE:
            return Object.assign({}, state, {
                monitorIssue: null,
            });

        case 'UPDATE_DATE_RANGE':
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    startDate: action.payload.startDate,
                    endDate: action.payload.endDate,
                },
            });

        case 'UPDATE_MONITOR_LOG': {
            const isPresent =
                state.monitorLogs &&
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                state.monitorLogs[action.payload.monitorId] &&
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                state.monitorLogs[action.payload.monitorId].logs
                    ? true
                    : false;
            const newMonitorLogs = isPresent
                ? {
                      ...state.monitorLogs,
                      [action.payload.monitorId]: {
                          // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                          ...state.monitorLogs[action.payload.monitorId],
                          logs: (() => {
                              // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                              state.monitorLogs[
                                  action.payload.monitorId
                              ].logs.unshift(action.payload.logData);
                              // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                              state.monitorLogs[
                                  action.payload.monitorId
                              ].logs.pop();
                              // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                              return state.monitorLogs[action.payload.monitorId]
                                  .logs;
                          })(),
                          count:
                              // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                              state.monitorLogs[action.payload.monitorId]
                                  .count + 1,
                      },
                  }
                : {
                      ...state.monitorLogs,
                      [action.payload.monitorId]: {
                          logs: [action.payload.logData],
                          error: null,
                          requesting: false,
                          success: false,
                          skip: 0,
                          limit: 10,
                          count: 1,
                      },
                  };
            return Object.assign({}, state, {
                monitorLogs: newMonitorLogs,
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                        monitor.monitors =
                            // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                            monitor._id === action.payload.projectId
                                ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors.map((monitor: $TSFixMe) => {
                                      if (
                                          monitor._id ===
                                          action.payload.monitorId
                                      ) {
                                          const data = Object.assign(
                                              {},
                                              action.payload.data
                                          );
                                          const intervalInDays = moment(
                                              state.monitorsList.endDate
                                          ).diff(
                                              moment(
                                                  state.monitorsList.startDate
                                              ),
                                              'days'
                                          );
                                          const isNewMonitor =
                                              moment(
                                                  state.monitorsList.endDate
                                              ).diff(
                                                  moment(monitor.createdAt),
                                                  'days'
                                              ) < 2;

                                          let dateFormat: $TSFixMe,
                                              outputFormat;
                                          if (
                                              intervalInDays > 30 &&
                                              !isNewMonitor
                                          ) {
                                              dateFormat = 'weeks';
                                              outputFormat =
                                                  'wo [week of] YYYY';
                                          } else if (
                                              intervalInDays > 2 &&
                                              !isNewMonitor
                                          ) {
                                              dateFormat = 'days';
                                              outputFormat = 'MMM Do YYYY';
                                          } else {
                                              if (
                                                  moment(
                                                      state.monitorsList.endDate
                                                  ).diff(
                                                      moment(monitor.createdAt),
                                                      'minutes'
                                                  ) > 60
                                              ) {
                                                  dateFormat = 'hours';
                                                  outputFormat =
                                                      'MMM Do YYYY, h A';
                                              } else {
                                                  dateFormat = 'minutes';
                                                  outputFormat =
                                                      'MMM Do YYYY, h:mm:ss A';
                                              }
                                          }

                                          const logData = {
                                              ...data,
                                              maxResponseTime:
                                                  data.responseTime,
                                              maxCpuLoad: data.cpuLoad,
                                              maxMemoryUsed: data.memoryUsed,
                                              maxStorageUsed: data.storageUsed,
                                              maxMainTemp: data.mainTemp,
                                              intervalDate: moment(
                                                  data.createdAt
                                              ).format(outputFormat),
                                          };

                                          monitor.logs =
                                              monitor.logs &&
                                              monitor.logs.length > 0
                                                  ? monitor.logs
                                                        .map(
                                                            (a: $TSFixMe) =>
                                                                a._id
                                                        )
                                                        .includes(
                                                            logData.probeId
                                                                ._id ||
                                                                logData.probeId
                                                        ) ||
                                                    !(
                                                        logData.probeId._id ||
                                                        logData.probeId
                                                    )
                                                      ? monitor.logs.map(
                                                            (
                                                                probeLogs: $TSFixMe
                                                            ) => {
                                                                const probeId =
                                                                    probeLogs._id;

                                                                if (
                                                                    probeId ===
                                                                        (logData
                                                                            .probeId
                                                                            ._id ||
                                                                            logData.probeId) ||
                                                                    (!probeId &&
                                                                        !(
                                                                            logData
                                                                                .probeId
                                                                                ._id ||
                                                                            logData.probeId
                                                                        ))
                                                                ) {
                                                                    if (
                                                                        probeLogs.logs &&
                                                                        probeLogs
                                                                            .logs
                                                                            .length >
                                                                            0 &&
                                                                        moment(
                                                                            probeLogs
                                                                                .logs[0]
                                                                                .createdAt
                                                                        ).isSame(
                                                                            moment(
                                                                                logData.createdAt
                                                                            ),
                                                                            dateFormat
                                                                        )
                                                                    ) {
                                                                        const currentLog =
                                                                            probeLogs
                                                                                .logs[0];

                                                                        logData.maxResponseTime =
                                                                            data.responseTime >
                                                                            currentLog.maxResponseTime
                                                                                ? data.responseTime
                                                                                : currentLog.maxResponseTime;
                                                                        logData.maxCpuLoad =
                                                                            data.cpuLoad >
                                                                            currentLog.maxCpuLoad
                                                                                ? data.cpuLoad
                                                                                : currentLog.maxCpuLoad;
                                                                        logData.maxMemoryUsed =
                                                                            data.memoryUsed >
                                                                            currentLog.maxMemoryUsed
                                                                                ? data.memoryUsed
                                                                                : currentLog.maxMemoryUsed;
                                                                        logData.maxStorageUsed =
                                                                            data.storageUsed >
                                                                            currentLog.maxStorageUsed
                                                                                ? data.storageUsed
                                                                                : currentLog.maxStorageUsed;
                                                                        logData.maxMainTemp =
                                                                            data.mainTemp >
                                                                            currentLog.maxMainTemp
                                                                                ? data.mainTemp
                                                                                : currentLog.maxMainTemp;

                                                                        return {
                                                                            _id: probeId,
                                                                            logs: [
                                                                                logData,
                                                                                ...probeLogs.logs.slice(
                                                                                    1
                                                                                ),
                                                                            ],
                                                                        };
                                                                    } else {
                                                                        return {
                                                                            _id: probeId,
                                                                            logs: [
                                                                                logData,
                                                                                ...probeLogs.logs,
                                                                            ],
                                                                        };
                                                                    }
                                                                } else {
                                                                    return probeLogs;
                                                                }
                                                            }
                                                        )
                                                      : [
                                                            ...monitor.logs,
                                                            {
                                                                _id:
                                                                    logData
                                                                        .probeId
                                                                        ._id ||
                                                                    logData.probeId ||
                                                                    null,
                                                                logs: [logData],
                                                            },
                                                        ]
                                                  : [
                                                        {
                                                            _id:
                                                                logData.probeId
                                                                    ._id ||
                                                                logData.probeId ||
                                                                null,
                                                            logs: [logData],
                                                        },
                                                    ];

                                          return monitor;
                                      } else {
                                          return monitor;
                                      }
                                  })
                                : // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors;

                        return monitor;
                    }),
                },
                fetchMonitorLogsRequest: false,
            });
        }

        case 'UPDATE_MONITOR_STATUS':
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(subProject => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                        subProject.monitors =
                            // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                            subProject._id === action.payload.status.projectId
                                ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  subProject.monitors.map(
                                      (monitor: $TSFixMe) => {
                                          if (
                                              monitor._id ===
                                              action.payload.status.monitorId
                                          ) {
                                              const data = Object.assign(
                                                  {},
                                                  action.payload.status.data
                                              );
                                              const probes =
                                                  action.payload.probes;
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
                                                      monitorProbes.includes(
                                                          data.probeId
                                                      ) ||
                                                      !data.probeId
                                                  ) {
                                                      monitor.statuses = monitor.statuses.map(
                                                          (
                                                              probeStatuses: $TSFixMe
                                                          ) => {
                                                              const probeId =
                                                                  probeStatuses._id;

                                                              if (
                                                                  probeId ===
                                                                      data.probeId ||
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
                                                          !probes.every(
                                                              (
                                                                  probe: $TSFixMe
                                                              ) =>
                                                                  monitorProbes.includes(
                                                                      probe._id
                                                                  )
                                                          )
                                                      ) {
                                                          // add manual status to all new probes
                                                          const newProbeStatuses: $TSFixMe = [];

                                                          probes.forEach(
                                                              (
                                                                  probe: $TSFixMe
                                                              ) => {
                                                                  if (
                                                                      !monitorProbes.includes(
                                                                          probe._id
                                                                      )
                                                                  ) {
                                                                      newProbeStatuses.push(
                                                                          {
                                                                              _id:
                                                                                  probe._id,
                                                                              statuses: [
                                                                                  data,
                                                                              ],
                                                                          }
                                                                      );
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
                                                              _id:
                                                                  data.probeId ||
                                                                  null,
                                                              statuses: [data],
                                                          },
                                                      ];
                                                  }
                                              } else {
                                                  if (isValidProbe) {
                                                      monitor.statuses = probes.map(
                                                          (
                                                              probe: $TSFixMe
                                                          ) => ({
                                                              _id: probe._id,
                                                              statuses: [data],
                                                          })
                                                      );
                                                  } else {
                                                      monitor.statuses = [
                                                          {
                                                              _id:
                                                                  data.probeId ||
                                                                  null,
                                                              statuses: [data],
                                                          },
                                                      ];
                                                  }
                                              }
                                          }
                                          return monitor;
                                      }
                                  )
                                : // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  subProject.monitors;

                        return subProject;
                    }),
                },
                fetchMonitorStatusesRequest: false,
            });

        case 'UPDATE_LIGHTHOUSE_LOG':
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                        monitor.monitors =
                            // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                            monitor._id === action.payload.projectId
                                ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors.map((monitor: $TSFixMe) => {
                                      if (
                                          monitor._id ===
                                          action.payload.monitorId
                                      ) {
                                          if (
                                              monitor.data &&
                                              monitor.data.url ===
                                                  action.payload.data.url
                                          ) {
                                              monitor.currentLighthouseLog =
                                                  action.payload.data;
                                          }
                                          if (
                                              monitor.lighthouseLogs &&
                                              monitor.lighthouseLogs.data &&
                                              monitor.lighthouseLogs.data
                                                  .length > 0
                                          ) {
                                              const logIndex = monitor.lighthouseLogs.data.findIndex(
                                                  (log: $TSFixMe) =>
                                                      log.url ===
                                                      action.payload.data.url
                                              );
                                              if (logIndex > -1) {
                                                  monitor.lighthouseLogs.data[
                                                      logIndex
                                                  ] = action.payload.data;
                                              }
                                          } else {
                                              monitor.lighthouseLogs = {
                                                  data: [action.payload.data],
                                                  skip: 0,
                                                  limit: 1,
                                                  count: 1,
                                              };
                                          }

                                          return monitor;
                                      } else {
                                          return monitor;
                                      }
                                  })
                                : // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors;
                        return monitor;
                    }),
                },
                fetchLighthouseLogsRequest: false,
            });
        case 'UPDATE_ALL_LIGHTHOUSE_LOG':
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                        monitor.monitors =
                            // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                            monitor._id === action.payload.projectId
                                ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors.map((monitor: $TSFixMe) => {
                                      if (
                                          monitor.data &&
                                          action.payload.data.logs.lighthouseLogs.some(
                                              (log: $TSFixMe) =>
                                                  monitor.currentLighthouseLog &&
                                                  log._id ===
                                                      monitor
                                                          .currentLighthouseLog
                                                          ._id
                                          )
                                      ) {
                                          monitor.currentLighthouseLog = action.payload.data.logs.lighthouseLogs.filter(
                                              (log: $TSFixMe) =>
                                                  monitor.currentLighthouseLog &&
                                                  log._id ===
                                                      monitor
                                                          .currentLighthouseLog
                                                          ._id
                                          )[0];
                                      }
                                      if (
                                          monitor._id ===
                                          action.payload.monitorId
                                      ) {
                                          monitor.lighthouseLogs = {
                                              data:
                                                  action.payload.data.logs
                                                      .lighthouseLogs,
                                              skip: 0,
                                              limit: 1,
                                              count: 1,
                                          };
                                          return monitor;
                                      } else {
                                          return monitor;
                                      }
                                  })
                                : // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors;
                        return monitor;
                    }),
                },
                fetchLighthouseLogsRequest: false,
            });
        case FETCH_MONITOR_CRITERIA_REQUEST:
            return Object.assign({}, state, {
                fetchMonitorCriteriaRequest: action.payload,
            });

        case FETCH_MONITOR_CRITERIA_SUCCESS:
            return Object.assign({}, state, {
                monitorCriteria: {
                    requesting: false,
                    error: null,
                    success: true,
                    criteria: action.payload.data,
                },
                fetchMonitorCriteriaRequest: false,
            });

        case FETCH_MONITOR_CRITERIA_FAILURE:
            return Object.assign({}, state, {
                monitorCriteria: {
                    ...state.monitorCriteria,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
                fetchMonitorCriteriaRequest: false,
            });

        case SET_MONITOR_CRITERIA:
            monitorType = action.payload.type;
            initialValue = Object.assign(
                {},
                monitorType &&
                    monitorType !== '' &&
                    (monitorType === 'url' ||
                        monitorType === 'api' ||
                        monitorType === 'script' ||
                        monitorType === 'server-monitor' ||
                        monitorType === 'incomingHttpRequest' ||
                        monitorType === 'kubernetes' ||
                        monitorType === 'ip')
                    ? // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                      state.monitorCriteria.criteria[monitorType]
                    : null
            );

            return Object.assign({}, state, {
                newMonitor: {
                    ...state.newMonitor,
                    initialValue: {
                        ...initialValue,
                        type_1000: monitorType,
                        name_1000: action.payload.name,
                        resourceCategory_1000: action.payload.category,
                        subProject_1000: action.payload.subProject,
                        callSchedules_1000: action.payload.schedules,
                        monitorSla: action.payload.monitorSla,
                        incidentCommunicationSla:
                            action.payload.incidentCommunicationSla,
                        kubernetesNamespace_1000:
                            action.payload.kubernetesNamespace || 'default',
                    },
                },
            });

        case REMOVE_MONITORS_SUBSCRIBERS:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                        monitor.monitors.find(
                            (targetMonitor: $TSFixMe, index: $TSFixMe) => {
                                if (
                                    targetMonitor._id ===
                                    action.payload.monitorId
                                ) {
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                    monitor.monitors[
                                        index
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                    ].subscribers.subscribers = monitor.monitors[
                                        index
                                    ].subscribers.subscribers.filter(
                                        (subscriber: $TSFixMe) =>
                                            subscriber._id !==
                                            action.payload._id
                                    );
                                    return true;
                                }
                                return false;
                            }
                        );
                        return monitor;
                    }),
                },
            });

        case DELETE_MONITOR_SUCCESS: {
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: false,
                    monitors: state.monitorsList.monitors.map(
                        subProjectMonitor => {
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                            subProjectMonitor.monitors = subProjectMonitor.monitors.filter(
                                ({ _id }: $TSFixMe) =>
                                    String(_id) !== String(action.payload)
                            );
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'never'.
                            subProjectMonitor.count =
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                subProjectMonitor.monitors.length;
                            return subProjectMonitor;
                        }
                    ),
                },
                deleteMonitor: false,
            });
        }

        case DELETE_MONITOR_FAILURE:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
                deleteMonitor: false,
            });

        case DELETE_MONITOR_REQUEST:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: false,
                },
                deleteMonitor: action.payload,
            });

        case DISABLE_MONITOR_SUCCESS: {
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: false,
                    monitors: state.monitorsList.monitors.map(
                        subProjectMonitor => {
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                            subProjectMonitor.monitors = subProjectMonitor.monitors.map(
                                (monitor: $TSFixMe) => {
                                    if (
                                        String(monitor._id) ===
                                        String(action.payload.monitorId)
                                    ) {
                                        monitor.disabled =
                                            action.payload.disable;
                                        return monitor;
                                    } else {
                                        return monitor;
                                    }
                                }
                            );
                            return subProjectMonitor;
                        }
                    ),
                },
                disableMonitor: false,
            });
        }

        case DISABLE_MONITOR_FAILURE:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
                disableMonitor: false,
            });

        case DISABLE_MONITOR_REQUEST:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: false,
                },
                disableMonitor: action.payload,
            });

        case CHANGE_MONITOR_COMPONENT_SUCCESS: {
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(
                        subProjectMonitor => {
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                            subProjectMonitor.monitors = subProjectMonitor.monitors.map(
                                (monitor: $TSFixMe) => {
                                    if (
                                        String(monitor._id) ===
                                        String(action.payload.monitorId)
                                    ) {
                                        monitor.componentId =
                                            action.payload.newComponentId;
                                        return monitor;
                                    } else {
                                        return monitor;
                                    }
                                }
                            );
                            return subProjectMonitor;
                        }
                    ),
                },
                changeMonitorComponent: {
                    ...state.changeMonitorComponent,
                    requesting: false,
                    error: null,
                    success: true,
                },
            });
        }

        case CHANGE_MONITOR_COMPONENT_FAILURE:
            return Object.assign({}, state, {
                changeMonitorComponent: {
                    ...state.changeMonitorComponent,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case CHANGE_MONITOR_COMPONENT_REQUEST:
            return Object.assign({}, state, {
                changeMonitorComponent: {
                    newComponentId: action.payload.newComponentId,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case DELETE_PROJECT_MONITORS:
            monitors = Object.assign([], state.monitorsList.monitors);
            monitors = monitors.filter(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'never... Remove this comment to see the full error message
                monitor => action.payload !== monitor.projectId
            );

            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    monitors,
                    error: null,
                    loading: false,
                },
            });

        case 'RESOLVE_INCIDENT_SUCCESS':
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                        monitor.monitors =
                            // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                            monitor._id === action.payload.projectId._id ||
                            action.payload.projectId
                                ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors.map((monitor: $TSFixMe) => {
                                      monitor.incidents = monitor.incidents
                                          ? monitor.incidents.map(
                                                (incident: $TSFixMe) => {
                                                    if (
                                                        incident._id ===
                                                        action.payload._id
                                                    ) {
                                                        return action.payload;
                                                    } else {
                                                        return incident;
                                                    }
                                                }
                                            )
                                          : [action.payload];
                                      return monitor;
                                  })
                                : // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors;
                        return monitor;
                    }),
                },
            });

        case 'ACKNOWLEDGE_INCIDENT_SUCCESS':
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                        monitor.monitors =
                            // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                            monitor._id === action.payload.projectId._id ||
                            action.payload.projectId
                                ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors.map((monitor: $TSFixMe) => {
                                      monitor.incidents = monitor.incidents
                                          ? monitor.incidents.map(
                                                (incident: $TSFixMe) => {
                                                    if (
                                                        incident._id ===
                                                        action.payload._id
                                                    ) {
                                                        return action.payload;
                                                    } else {
                                                        return incident;
                                                    }
                                                }
                                            )
                                          : [action.payload];
                                      return monitor;
                                  })
                                : // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors;
                        return monitor;
                    }),
                },
            });

        case 'INCIDENT_RESOLVED_BY_SOCKET':
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                        monitor.monitors =
                            // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                            monitor._id === action.payload.data.projectId._id ||
                            action.payload.data.projectId
                                ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors.map((monitor: $TSFixMe) => {
                                      monitor.incidents = monitor.incidents
                                          ? monitor.incidents.map(
                                                (incident: $TSFixMe) => {
                                                    if (
                                                        incident._id ===
                                                        action.payload.data._id
                                                    ) {
                                                        return action.payload
                                                            .data;
                                                    } else {
                                                        return incident;
                                                    }
                                                }
                                            )
                                          : [action.payload.data];
                                      return monitor;
                                  })
                                : // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors;
                        return monitor;
                    }),
                },
            });

        case 'INCIDENT_ACKNOWLEDGED_BY_SOCKET':
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                        monitor.monitors =
                            // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                            monitor._id === action.payload.data.projectId._id ||
                            action.payload.data.projectId
                                ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors.map((monitor: $TSFixMe) => {
                                      monitor.incidents = monitor.incidents
                                          ? monitor.incidents.map(
                                                (incident: $TSFixMe) => {
                                                    if (
                                                        incident._id ===
                                                        action.payload.data._id
                                                    ) {
                                                        return action.payload
                                                            .data;
                                                    } else {
                                                        return incident;
                                                    }
                                                }
                                            )
                                          : [action.payload.data];
                                      return monitor;
                                  })
                                : // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors;
                        return monitor;
                    }),
                },
            });

        case 'DELETE_MONITOR_BY_SOCKET':
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: false,
                    monitors: state.monitorsList.monitors.map(
                        subProjectMonitor => {
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                            subProjectMonitor.monitors = subProjectMonitor.monitors.filter(
                                ({ _id }: $TSFixMe) =>
                                    String(_id) !== String(action.payload)
                            );
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'never'.
                            subProjectMonitor.count =
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                subProjectMonitor.monitors.length;
                            return subProjectMonitor;
                        }
                    ),
                },
            });

        case 'ADD_NEW_INCIDENT_TO_MONITORS':
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                        monitor.monitors =
                            // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                            monitor._id ===
                            (action.payload.projectId._id ||
                                action.payload.projectId)
                                ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors.map((monitor: $TSFixMe) => {
                                      const monitors = action.payload.monitors.map(
                                          (monitor: $TSFixMe) =>
                                              monitor.monitorId
                                      );
                                      monitors.forEach(
                                          (monitorObj: $TSFixMe) => {
                                              if (
                                                  monitor._id === monitorObj._id
                                              ) {
                                                  let incidents =
                                                      monitor.incidents || [];

                                                  if (
                                                      incidents &&
                                                      incidents.length
                                                  ) {
                                                      if (
                                                          incidents.length > 2
                                                      ) {
                                                          incidents.splice(
                                                              -1,
                                                              1
                                                          );
                                                      }
                                                      let found = false;
                                                      for (const incident of incidents) {
                                                          if (
                                                              String(
                                                                  incident._id
                                                              ) ===
                                                              String(
                                                                  action.payload
                                                                      ._id
                                                              )
                                                          ) {
                                                              found = true;
                                                              return;
                                                          }
                                                      }
                                                      !found &&
                                                          incidents.unshift(
                                                              action.payload
                                                          );
                                                  } else {
                                                      incidents = [
                                                          action.payload,
                                                      ];
                                                  }
                                                  monitor = {
                                                      ...monitor,
                                                      incidents: incidents,
                                                      count: monitor.count + 1,
                                                  };
                                              }
                                          }
                                      );
                                      return monitor;
                                  })
                                : // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'never'... Remove this comment to see the full error message
                                  monitor.monitors;
                        return monitor;
                    }),
                },
            });

        case ADD_SEAT_SUCCESS:
            return Object.assign({}, state, {
                addseat: {
                    requesting: false,
                    error: null,
                    success: action.payload,
                },
            });

        case ADD_SEAT_FAILURE:
            return Object.assign({}, state, {
                addseat: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case ADD_SEAT_REQUEST:
            return Object.assign({}, state, {
                addseat: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case ADD_SEAT_RESET:
            return Object.assign({}, state, {
                addseat: {
                    requesting: false,
                    error: null,
                    success: false,
                },
            });

        case SELECT_PROBE:
            return Object.assign({}, state, {
                activeProbe: action.payload,
            });

        case GET_MONITOR_LOGS_SUCCESS: {
            const monitorId = action.payload.monitorId
                ? action.payload.monitorId
                : action.payload.logs && action.payload.logs.length > 0
                ? action.payload.logs[0].monitorId
                : null;
            return Object.assign({}, state, {
                monitorLogs: {
                    ...state.monitorLogs,
                    [monitorId]: {
                        logs: action.payload.logs,
                        error: null,
                        requesting: false,
                        success: false,
                        skip: action.payload.skip,
                        limit: action.payload.limit,
                        count: action.payload.count,
                    },
                },
            });
        }

        case GET_MONITOR_LOGS_FAILURE: {
            const failureLogs = {
                ...state.monitorLogs,
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                [action.payload.monitorId]: state.monitorLogs[
                    action.payload.monitorId
                ]
                    ? {
                          // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                          ...state.monitorLogs[action.payload.monitorId],
                          error: action.payload.error,
                      }
                    : {
                          logs: [],
                          probes: [],
                          error: action.payload.error,
                          requesting: false,
                          success: false,
                          skip: 0,
                          limit: 10,
                          count: null,
                      },
            };
            return Object.assign({}, state, {
                monitorLogs: failureLogs,
            });
        }

        case GET_MONITOR_LOGS_REQUEST: {
            const requestLogs = {
                ...state.monitorLogs,
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                [action.payload.monitorId]: state.monitorLogs[
                    action.payload.monitorId
                ]
                    ? {
                          // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                          ...state.monitorLogs[action.payload.monitorId],
                          requesting: true,
                      }
                    : {
                          logs: [],
                          probes: [],
                          error: null,
                          requesting: true,
                          success: false,
                          skip: 0,
                          limit: 10,
                          count: null,
                      },
            };
            return Object.assign({}, state, {
                monitorLogs: requestLogs,
            });
        }

        case GET_MONITOR_LOGS_RESET:
            return Object.assign({}, state, {
                monitorLogs: INITIAL_STATE.monitorLogs,
            });

        case FETCH_BREACHED_MONITOR_SLA_REQUEST:
            return {
                ...state,
                monitorSlaBreaches: {
                    ...state.monitorSlaBreaches,
                    requesting: true,
                    error: null,
                    success: false,
                },
            };

        case FETCH_BREACHED_MONITOR_SLA_SUCCESS:
            return {
                ...state,
                monitorSlaBreaches: {
                    requesting: false,
                    success: true,
                    error: null,
                    slaBreaches: action.payload,
                },
            };

        case FETCH_BREACHED_MONITOR_SLA_FAILURE:
            return {
                ...state,
                monitorSlaBreaches: {
                    ...state.monitorSlaBreaches,
                    success: false,
                    requesting: false,
                    error: action.payload,
                },
            };

        case CLOSE_BREACHED_MONITOR_SLA_REQUEST:
            return {
                ...state,
                closeBreachedMonitorSla: {
                    ...state.closeBreachedMonitorSla,
                    success: false,
                    requesting: true,
                    error: null,
                },
            };

        case CLOSE_BREACHED_MONITOR_SLA_SUCCESS: {
            const slaBreaches = state.monitorSlaBreaches.slaBreaches.filter(
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                monitor => String(monitor._id) !== String(action.payload._id)
            );

            return {
                ...state,
                closeBreachedMonitorSla: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                monitorSlaBreaches: {
                    ...state.monitorSlaBreaches,
                    slaBreaches,
                },
            };
        }

        case CLOSE_BREACHED_MONITOR_SLA_FAILURE:
            return {
                ...state,
                closeBreachedMonitorSla: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        default:
            return state;
    }
}
