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
    fetchMonitorStatusesRequest: false,
    fetchLighthouseLogsRequest: false,
    fetchMonitorCriteriaRequest: false,
    fetchMonitorsSubscriberRequest: false,
    deleteMonitor: false,
    disableMonitor: false,
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
};

export default function monitor(state = INITIAL_STATE, action) {
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

        case CREATE_MONITOR_SUCCESS:
        case 'CREATE_MONITOR': {
            let monitorFound = false;
            const monitors = state.monitorsList.monitors.map(monitorData => {
                let output = {
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
                    success: false,
                    monitors: action.payload,
                },
            });

        case FETCH_MONITORS_FAILURE:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: action.payload,
                    success: false,
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
                            subProject.monitors && subProject.monitors.slice();

                        const newMonitor = Object.assign({}, action.payload);

                        const monitorIndex =
                            subProjectMonitors &&
                            subProjectMonitors.findIndex(
                                monitor => monitor._id === newMonitor._id
                            );
                        const isSubProjectMonitor = monitorIndex > -1;

                        if (subProject._id === newMonitor.projectId._id) {
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
                                subProject.count += 1;
                            }
                        } else {
                            if (isSubProjectMonitor) {
                                subProjectMonitors.splice(monitorIndex, 1);
                                subProject.count -= 1;
                            }
                        }

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
                        monitor.monitors = monitor.monitors.map(
                            (monitor, i) => {
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
                        monitor.monitors =
                            monitor._id === action.payload.projectId
                                ? monitor.monitors.map(monitor => {
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
                                : monitor.monitors;
                        return monitor;
                    }),
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
                        monitor.monitors =
                            monitor._id === action.payload.projectId
                                ? monitor.monitors.map(monitor => {
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
                                : monitor.monitors;
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
            });

        case FETCH_MONITOR_LOGS_SUCCESS:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        monitor.monitors =
                            monitor._id === action.payload.projectId
                                ? monitor.monitors.map(monitor => {
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
                                : monitor.monitors;
                        return monitor;
                    }),
                },
                fetchMonitorLogsRequest: false,
            });

        case FETCH_MONITOR_LOGS_FAILURE:
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
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
                        monitor.monitors =
                            monitor._id === action.payload.projectId
                                ? monitor.monitors.map(monitor => {
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
                                : monitor.monitors;
                        return monitor;
                    }),
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
                        monitor.monitors =
                            monitor._id === action.payload.projectId
                                ? monitor.monitors.map(monitor => {
                                      if (
                                          monitor._id ===
                                          action.payload.monitorId
                                      ) {
                                          const mainSiteUrlLogs = action.payload.logs.data.filter(
                                              log =>
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
                                : monitor.monitors;
                        return monitor;
                    }),
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

        case 'UPDATE_MONITOR_LOG':
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(monitor => {
                        monitor.monitors =
                            monitor._id === action.payload.projectId
                                ? monitor.monitors.map(monitor => {
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

                                          let dateFormat, outputFormat;
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
                                                        .map(a => a._id)
                                                        .includes(
                                                            logData.probeId
                                                        ) || !logData.probeId
                                                      ? monitor.logs.map(
                                                            probeLogs => {
                                                                const probeId =
                                                                    probeLogs._id;

                                                                if (
                                                                    probeId ===
                                                                        logData.probeId ||
                                                                    (!probeId &&
                                                                        !logData.probeId)
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
                                                                    logData.probeId ||
                                                                    null,
                                                                logs: [logData],
                                                            },
                                                        ]
                                                  : [
                                                        {
                                                            _id:
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
                                : monitor.monitors;

                        return monitor;
                    }),
                },
                fetchMonitorLogsRequest: false,
            });

        case 'UPDATE_MONITOR_STATUS':
            return Object.assign({}, state, {
                monitorsList: {
                    ...state.monitorsList,
                    requesting: false,
                    error: null,
                    success: true,
                    monitors: state.monitorsList.monitors.map(subProject => {
                        subProject.monitors =
                            subProject._id === action.payload.status.projectId
                                ? subProject.monitors.map(monitor => {
                                      if (
                                          monitor._id ===
                                          action.payload.status.monitorId
                                      ) {
                                          const data = Object.assign(
                                              {},
                                              action.payload.status.data
                                          );
                                          const probes = action.payload.probes;
                                          const isValidProbe =
                                              (monitor.type === 'url' ||
                                                  monitor.type === 'api' ||
                                                  monitor.type === 'device') &&
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
                                                  monitorProbes.includes(
                                                      data.probeId
                                                  ) ||
                                                  !data.probeId
                                              ) {
                                                  monitor.statuses = monitor.statuses.map(
                                                      probeStatuses => {
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
                                                      !probes.every(probe =>
                                                          monitorProbes.includes(
                                                              probe._id
                                                          )
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
                                                      probe => ({
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
                                  })
                                : subProject.monitors;

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
                        monitor.monitors =
                            monitor._id === action.payload.projectId
                                ? monitor.monitors.map(monitor => {
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
                                                  log =>
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
                                : monitor.monitors;
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
                        monitorType === 'incomingHttpRequest')
                    ? state.monitorCriteria.criteria[monitorType]
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
                        callSchedule_1000: action.payload.schedule,
                        monitorSla: action.payload.monitorSla,
                        incidentCommunicationSla:
                            action.payload.incidentCommunicationSla,
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
                        monitor.monitors.find((targetMonitor, index) => {
                            if (
                                targetMonitor._id === action.payload.monitorId
                            ) {
                                monitor.monitors[
                                    index
                                ].subscribers.subscribers = monitor.monitors[
                                    index
                                ].subscribers.subscribers.filter(
                                    subscriber =>
                                        subscriber._id !== action.payload._id
                                );
                                return true;
                            }
                            return false;
                        });
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
                            subProjectMonitor.monitors = subProjectMonitor.monitors.filter(
                                ({ _id }) =>
                                    String(_id) !== String(action.payload)
                            );
                            subProjectMonitor.count =
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
                            subProjectMonitor.monitors = subProjectMonitor.monitors.map(
                                monitor => {
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

        case DELETE_PROJECT_MONITORS:
            monitors = Object.assign([], state.monitorsList.monitors);
            monitors = monitors.filter(
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
                        monitor.monitors =
                            monitor._id === action.payload.projectId
                                ? monitor.monitors.map(monitor => {
                                      monitor.incidents = monitor.incidents
                                          ? monitor.incidents.map(incident => {
                                                if (
                                                    incident._id ===
                                                    action.payload._id
                                                ) {
                                                    return action.payload;
                                                } else {
                                                    return incident;
                                                }
                                            })
                                          : [action.payload];
                                      return monitor;
                                  })
                                : monitor.monitors;
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
                        monitor.monitors =
                            monitor._id === action.payload.projectId
                                ? monitor.monitors.map(monitor => {
                                      monitor.incidents = monitor.incidents
                                          ? monitor.incidents.map(incident => {
                                                if (
                                                    incident._id ===
                                                    action.payload._id
                                                ) {
                                                    return action.payload;
                                                } else {
                                                    return incident;
                                                }
                                            })
                                          : [action.payload];
                                      return monitor;
                                  })
                                : monitor.monitors;
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
                        monitor.monitors =
                            monitor._id === action.payload.projectId
                                ? monitor.monitors.map(monitor => {
                                      monitor.incidents = monitor.incidents
                                          ? monitor.incidents.map(incident => {
                                                if (
                                                    incident._id ===
                                                    action.payload.data._id
                                                ) {
                                                    return action.payload.data;
                                                } else {
                                                    return incident;
                                                }
                                            })
                                          : [action.payload.data];
                                      return monitor;
                                  })
                                : monitor.monitors;
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
                        monitor.monitors =
                            monitor._id === action.payload.projectId
                                ? monitor.monitors.map(monitor => {
                                      monitor.incidents = monitor.incidents
                                          ? monitor.incidents.map(incident => {
                                                if (
                                                    incident._id ===
                                                    action.payload.data._id
                                                ) {
                                                    return action.payload.data;
                                                } else {
                                                    return incident;
                                                }
                                            })
                                          : [action.payload.data];
                                      return monitor;
                                  })
                                : monitor.monitors;
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
                            subProjectMonitor.monitors = subProjectMonitor.monitors.filter(
                                ({ _id }) =>
                                    String(_id) !== String(action.payload)
                            );
                            subProjectMonitor.count =
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
                        monitor.monitors =
                            monitor._id === action.payload.projectId
                                ? monitor.monitors.map(monitor => {
                                      if (
                                          monitor._id ===
                                          action.payload.monitorId._id
                                      ) {
                                          let incidents =
                                              monitor.incidents || [];

                                          if (incidents && incidents.length) {
                                              if (incidents.length > 2) {
                                                  incidents.splice(-1, 1);
                                              }
                                              incidents.unshift(action.payload);
                                          } else {
                                              incidents = [action.payload];
                                          }
                                          return {
                                              ...monitor,
                                              incidents: incidents,
                                              count: monitor.count + 1,
                                          };
                                      } else {
                                          return monitor;
                                      }
                                  })
                                : monitor.monitors;
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
                [action.payload.monitorId]: state.monitorLogs[
                    action.payload.monitorId
                ]
                    ? {
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
                [action.payload.monitorId]: state.monitorLogs[
                    action.payload.monitorId
                ]
                    ? {
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
