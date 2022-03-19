import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/monitor';
import errors from '../errors';

import { change, autofill } from 'redux-form';
//import { PricingPlan } from '../config';
//import { User } from '../config';
//import { upgradePlanEmpty, upgradeToEnterpriseMail } from '../actions/project';

//Monitor list
//props -> {name: '', type, data -> { data.url}}
export function fetchMonitors(projectId: $TSFixMe, skip = 0, limit = 0) {
    return function (dispatch: $TSFixMe) {
        const promise = getApi(
            `monitor/${projectId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchMonitorsRequest());

        promise.then(
            function (monitors) {
                dispatch(fetchMonitorsSuccess(monitors.data));
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
                dispatch(fetchMonitorsFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function fetchMonitorsSuccess(monitors: $TSFixMe) {
    return {
        type: types.FETCH_MONITORS_SUCCESS,
        payload: monitors,
    };
}

export function fetchMonitorsRequest() {
    return {
        type: types.FETCH_MONITORS_REQUEST,
    };
}

export function fetchMonitorsFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_MONITORS_FAILURE,
        payload: error,
    };
}

export function resetFetchMonitors() {
    return {
        type: types.FETCH_MONITORS_RESET,
    };
}

//Monitor list
//props -> {name: '', type, data -> { data.url}}
export function fetchPaginatedMonitors({
    projectId,
    skip = 0,
    limit = 0,
    componentSlug,
    componentId,
    paginate = false,
}: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        let url = `monitor/${projectId}/paginated?skip=${skip}&limit=${limit}&componentId=${componentId}`;
        if (componentSlug) {
            url = `monitor/${projectId}/paginated?skip=${skip}&limit=${limit}&componentSlug=${componentSlug}`;
        }
        const promise = getApi(url);
        dispatch(fetchPaginatedMonitorsRequest(paginate));

        promise.then(
            function (monitors) {
                dispatch(fetchPaginatedMonitorsSuccess(monitors.data));
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
                dispatch(fetchPaginatedMonitorsFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function fetchPaginatedMonitorsSuccess(monitors: $TSFixMe) {
    return {
        type: types.FETCH_PAGINATED_MONITORS_SUCCESS,
        payload: monitors,
    };
}

export function fetchPaginatedMonitorsRequest(paginate: $TSFixMe) {
    return {
        type: types.FETCH_PAGINATED_MONITORS_REQUEST,
        payload: paginate,
    };
}

export function fetchPaginatedMonitorsFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_PAGINATED_MONITORS_FAILURE,
        payload: error,
    };
}

//Create new monitor
//props -> {name: '', type, data -> { data.url}}
export function createMonitor(projectId: $TSFixMe, values: $TSFixMe) {
    values.projectId = values.projectId._id || values.projectId;
    return function (dispatch: $TSFixMe) {
        dispatch(createMonitorRequest());
        const promise = postApi(`monitor/${projectId}`, values);
        promise.then(
            function (monitor) {
                dispatch(createMonitorSuccess(monitor.data));
                dispatch(resetFile());

                return monitor.data;
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
                dispatch(createMonitorFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function uploadIdentityFile(projectId: $TSFixMe, file: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        const data = new FormData();
        if (file) {
            data.append('identityFile', file);

            const promise = postApi(`monitor/${projectId}/identityFile`, data);
            dispatch(uploadIdentityFileRequest());
            promise.then(
                function (response) {
                    const data = response.data;
                    dispatch(logFile(data.identityFile));
                    return data;
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
                    dispatch(resetFile());
                }
            );

            return promise;
        }
    };
}

export function uploadIdentityFileRequest() {
    return {
        type: types.UPLOAD_IDENTITY_FILE_REQUEST,
    };
}

export function logFile(file: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch({ type: types.UPLOAD_IDENTITY_FILE_SUCCESS, payload: file });
    };
}

export function resetFile() {
    return function (dispatch: $TSFixMe) {
        dispatch({ type: types.RESET_UPLOAD_IDENTITY_FILE });
    };
}

export function uploadConfigurationFileRequest() {
    return {
        type: types.UPLOAD_CONFIGURATION_FILE_REQUEST,
    };
}

export function logConfigFile(file: $TSFixMe) {
    return (dispatch: $TSFixMe) =>
        dispatch({
            type: types.UPLOAD_CONFIGURATION_FILE_SUCCESS,
            payload: file,
        });
}

export function resetConfigFile() {
    return (dispatch: $TSFixMe) =>
        dispatch({
            type: types.RESET_UPLOAD_CONFIGURATION_FILE,
        });
}

export function setConfigInputKey(value: $TSFixMe) {
    return {
        type: types.SET_CONFIGURATION_FILE_INPUT_KEY,
        payload: value,
    };
}

export function uploadConfigurationFile(projectId: $TSFixMe, file: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        const data = new FormData();
        if (file) {
            data.append('configurationFile', file);

            const promise = postApi(
                `monitor/${projectId}/configurationFile`,
                data
            );
            dispatch(uploadConfigurationFileRequest());
            promise.then(
                function (response) {
                    const data = response.data;
                    dispatch(logConfigFile(data.configurationFile));
                    return data;
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
                    dispatch(resetConfigFile());
                }
            );

            return promise;
        }
    };
}

export function setFileInputKey(value: $TSFixMe) {
    return {
        type: 'SET_IDENTITY_FILE_INPUT_KEY',
        payload: value,
    };
}

export function toggleEdit(payload: $TSFixMe) {
    return {
        type: types.TOGGLE_EDIT,
        payload,
    };
}

export function createMonitorSuccess(newMonitor: $TSFixMe) {
    return {
        type: types.CREATE_MONITOR_SUCCESS,
        payload: newMonitor,
    };
}

export function createMonitorRequest() {
    return {
        type: types.CREATE_MONITOR_REQUEST,
    };
}

export function createMonitorFailure(error: $TSFixMe) {
    return {
        type: types.CREATE_MONITOR_FAILURE,
        payload: error,
    };
}

export function resetCreateMonitor() {
    return {
        type: types.CREATE_MONITOR_RESET,
    };
}

//Edit new monitor
//props -> {name: '', type, data -> { data.url}}
export function editMonitor(projectId: $TSFixMe, values: $TSFixMe) {
    values.projectId = values.projectId._id || values.projectId || projectId;
    return function (dispatch: $TSFixMe) {
        const promise = putApi(`monitor/${projectId}/${values._id}`, values);
        if (
            !values.lighthouseScanStatus ||
            (values.lighthouseScanStatus &&
                values.lighthouseScanStatus !== 'scan')
        ) {
            dispatch(editMonitorRequest());
        }
        promise.then(
            function (monitor) {
                dispatch(editMonitorSuccess(monitor.data));
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
                dispatch(editMonitorFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function editMonitorSuccess(newMonitor: $TSFixMe) {
    if (newMonitor.lighthouseScanStatus === 'scanning') {
        fetchLighthouseLogs(newMonitor.projectId._id, newMonitor._id, 0, 5);
    }
    return {
        type: types.EDIT_MONITOR_SUCCESS,
        payload: newMonitor,
    };
}

export function editMonitorRequest() {
    return {
        type: types.EDIT_MONITOR_REQUEST,
    };
}

export function editMonitorFailure(error: $TSFixMe) {
    return {
        type: types.EDIT_MONITOR_FAILURE,
        payload: error,
    };
}

export function editMonitorSwitch(index: $TSFixMe) {
    return {
        type: types.EDIT_MONITOR_SWITCH,
        payload: index,
    };
}

export function resetEditMonitor() {
    return {
        type: types.EDIT_MONITOR_RESET,
    };
}

//Add new site url
//props -> siteUrl
export function addSiteUrl(
    monitorId: $TSFixMe,
    projectId: $TSFixMe,
    siteUrl: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = postApi(`monitor/${projectId}/siteUrl/${monitorId}`, {
            siteUrl,
        });
        dispatch(editMonitorRequest());

        promise.then(
            function (monitor) {
                dispatch(editMonitorSuccess(monitor.data));
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
                dispatch(editMonitorFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function deleteSiteUrl(
    monitorId: $TSFixMe,
    projectId: $TSFixMe,
    siteUrl: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = deleteApi(`monitor/${projectId}/siteUrl/${monitorId}`, {
            siteUrl,
        });
        dispatch(editMonitorRequest());

        promise.then(
            function (monitor) {
                dispatch(editMonitorSuccess(monitor.data));
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
                dispatch(editMonitorFailure(errors(error)));
            }
        );

        return promise;
    };
}

//Delete a monitor
//props -> {name: '', type, data -> { data.url}}
export function deleteMonitor(monitorId: $TSFixMe, projectId: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        const promise = deleteApi(`monitor/${projectId}/${monitorId}`);
        dispatch(deleteMonitorRequest(monitorId));

        promise.then(
            function (monitor) {
                dispatch(deleteMonitorSuccess(monitor.data._id));
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
                dispatch(
                    deleteMonitorFailure({ error: errors(error), monitorId })
                );
            }
        );

        return promise;
    };
}

export function deleteMonitorSuccess(removedMonitorId: $TSFixMe) {
    return {
        type: types.DELETE_MONITOR_SUCCESS,
        payload: removedMonitorId,
    };
}

export function deleteMonitorRequest(monitorId: $TSFixMe) {
    return {
        type: types.DELETE_MONITOR_REQUEST,
        payload: monitorId,
    };
}

export function deleteMonitorFailure(error: $TSFixMe) {
    return {
        type: types.DELETE_MONITOR_FAILURE,
        payload: error,
    };
}

export function deleteProjectMonitors(projectId: $TSFixMe) {
    return {
        type: types.DELETE_PROJECT_MONITORS,
        payload: projectId,
    };
}

//Disable a monitor
export function disableMonitor(monitorId: $TSFixMe, projectId: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        const promise = postApi(
            `monitor/${projectId}/disableMonitor/${monitorId}`,
            {
                monitorId,
            }
        );
        dispatch(disableMonitorRequest(monitorId));

        promise.then(
            function (monitor) {
                dispatch(
                    disableMonitorSuccess({
                        monitorId: monitor.data._id,

                        disable: monitor.data.disabled,
                    })
                );
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
                dispatch(
                    disableMonitorFailure({ error: errors(error), monitorId })
                );
            }
        );

        return promise;
    };
}

export function disableMonitorSuccess(monitorData: $TSFixMe) {
    return {
        type: types.DISABLE_MONITOR_SUCCESS,
        payload: monitorData,
    };
}

export function disableMonitorRequest(monitorId: $TSFixMe) {
    return {
        type: types.DISABLE_MONITOR_REQUEST,
        payload: monitorId,
    };
}

export function disableMonitorFailure(error: $TSFixMe) {
    return {
        type: types.DISABLE_MONITOR_FAILURE,
        payload: error,
    };
}

// Change monitor's parent component
export const changeMonitorComponent = (
    projectId: $TSFixMe,
    monitorId: $TSFixMe,
    newComponentId: $TSFixMe
) => {
    return async (dispatch: $TSFixMe) => {
        try {
            dispatch(changeMonitorComponentRequest(monitorId));
            const monitor = await postApi(
                `monitor/${projectId}/changeComponent/${monitorId}`,
                {
                    newComponentId,
                }
            );

            dispatch(
                changeMonitorComponentSuccess({
                    monitorId: monitor.data._id,

                    newComponentId: monitor.data.componentId,
                })
            );

            return monitor;
        } catch (err) {
            let error = { ...err };
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
            dispatch(changeMonitorComponentFailure(error));

            // rethrow the error?
        }
    };
};

export const changeMonitorComponentRequest = (monitorId: $TSFixMe) => {
    return {
        type: types.CHANGE_MONITOR_COMPONENT_REQUEST,
        payload: monitorId,
    };
};

export const changeMonitorComponentSuccess = ({
    monitorId,
    newComponentId,
}: $TSFixMe) => {
    return {
        type: types.CHANGE_MONITOR_COMPONENT_SUCCESS,
        payload: {
            monitorId,
            newComponentId,
        },
    };
};

export const changeMonitorComponentFailure = (error: $TSFixMe) => {
    return {
        type: types.CHANGE_MONITOR_COMPONENT_FAILURE,
        payload: error,
    };
};

//Fetch Incidents of monitors
//props -> {name: '', type, data -> { data.url}}
export function fetchMonitorsIncidents(
    projectId: $TSFixMe,
    monitorId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = postApi(`incident/${projectId}/monitor/${monitorId}`, {
            limit,
            skip,
        });
        dispatch(fetchMonitorsIncidentsRequest(monitorId));

        promise.then(
            function (monitors) {
                dispatch(
                    fetchMonitorsIncidentsSuccess({
                        projectId,
                        monitorId,

                        incidents: monitors.data,
                        skip,
                        limit,

                        count: monitors.data.count,
                    })
                );
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
                dispatch(fetchMonitorsIncidentsFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function fetchMonitorsIncidentsSuccess(monitors: $TSFixMe) {
    return {
        type: types.FETCH_MONITORS_INCIDENT_SUCCESS,
        payload: monitors,
    };
}

export function fetchMonitorsIncidentsRequest(monitorId: $TSFixMe) {
    return {
        type: types.FETCH_MONITORS_INCIDENT_REQUEST,
        payload: monitorId,
    };
}

export function fetchMonitorsIncidentsFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_MONITORS_INCIDENT_FAILURE,
        payload: error,
    };
}

//Fetch Subscribers of monitors
export function fetchMonitorsSubscribers(
    projectId: $TSFixMe,
    monitorId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = getApi(
            `subscriber/${projectId}/monitor/${monitorId}?limit=${limit}&skip=${skip}`
        );
        dispatch(fetchMonitorsSubscribersRequest(monitorId));

        promise.then(
            function (subscribers) {
                dispatch(
                    fetchMonitorsSubscribersSuccess({
                        projectId,
                        monitorId,

                        subscribers: subscribers.data,
                        skip: skip,
                        limit: limit,

                        count: subscribers.data.count,
                    })
                );
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
                dispatch(fetchMonitorsSubscribersFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function fetchMonitorsSubscribersSuccess(monitors: $TSFixMe) {
    return {
        type: types.FETCH_MONITORS_SUBSCRIBER_SUCCESS,
        payload: monitors,
    };
}

export function fetchMonitorsSubscribersRequest(monitorId: $TSFixMe) {
    return {
        type: types.FETCH_MONITORS_SUBSCRIBER_REQUEST,
        payload: monitorId,
    };
}

export function fetchMonitorsSubscribersFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_MONITORS_SUBSCRIBER_FAILURE,
        payload: error,
    };
}

// Fetch Monitor Logs
export function fetchMonitorLogs(
    projectId: $TSFixMe,
    monitorId: $TSFixMe,
    startDate: $TSFixMe,
    endDate: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = postApi(
            `monitor/${projectId}/monitorLog/${monitorId}`,
            { startDate, endDate }
        );
        dispatch(fetchMonitorLogsRequest(monitorId));
        dispatch(updateDateRange(startDate, endDate));

        promise.then(
            function (monitorLogs) {
                dispatch(
                    fetchMonitorLogsSuccess({
                        projectId,
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

export function updateDateRange(startDate: $TSFixMe, endDate: $TSFixMe) {
    return {
        type: 'UPDATE_DATE_RANGE',
        payload: { startDate, endDate },
    };
}

export function fetchMonitorLogsRequest(payload: $TSFixMe) {
    return {
        type: types.FETCH_MONITOR_LOGS_REQUEST,
        payload,
    };
}

export function fetchMonitorLogsSuccess(monitorLogs: $TSFixMe) {
    return {
        type: types.FETCH_MONITOR_LOGS_SUCCESS,
        payload: monitorLogs,
    };
}

export function fetchMonitorLogsFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_MONITOR_LOGS_FAILURE,
        payload: error,
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
            `monitor/${projectId}/monitorStatuses/${monitorId}`,
            { startDate, endDate }
        );
        dispatch(fetchMonitorStatusesRequest());

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

export function fetchMonitorStatusesRequest() {
    return {
        type: types.FETCH_MONITOR_STATUSES_REQUEST,
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

// Fetch Monitor Criteria
export function fetchMonitorCriteria() {
    return function (dispatch: $TSFixMe) {
        const promise = getApi('monitorCriteria');
        dispatch(fetchMonitorCriteriaRequest());

        promise.then(
            function (monitorCriteria) {
                dispatch(fetchMonitorCriteriaSuccess(monitorCriteria));
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
                dispatch(fetchMonitorCriteriaFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function fetchMonitorCriteriaRequest() {
    return {
        type: types.FETCH_MONITOR_CRITERIA_REQUEST,
    };
}

export function fetchMonitorCriteriaSuccess(monitorCriteria: $TSFixMe) {
    return {
        type: types.FETCH_MONITOR_CRITERIA_SUCCESS,
        payload: monitorCriteria,
    };
}

export function fetchMonitorCriteriaFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_MONITOR_CRITERIA_FAILURE,
        payload: error,
    };
}

export function setMonitorCriteria(
    monitorName: $TSFixMe,
    monitorCategory: $TSFixMe,
    monitorSubProject: $TSFixMe,
    monitorCallSchedules: $TSFixMe,
    monitorSla: $TSFixMe,
    incidentCommunicationSla: $TSFixMe,
    monitorType: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: types.SET_MONITOR_CRITERIA,
            payload: {
                name: monitorName,
                category: monitorCategory,
                subProject: monitorSubProject,
                schedules: monitorCallSchedules,
                type: monitorType,
                monitorSla,
                incidentCommunicationSla,
            },
        });
    };
}

//Fetch Logs of monitors
export function getMonitorLogs(
    projectId: $TSFixMe,
    monitorId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe,
    startDate: $TSFixMe,
    endDate: $TSFixMe,
    probeValue: $TSFixMe,
    incidentId: $TSFixMe,
    type: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = postApi(
            `monitor/${projectId}/monitorLogs/${monitorId}`,
            {
                skip,
                limit,
                startDate,
                endDate,
                probeValue,
                incidentId: incidentId ? incidentId : null,
                type,
            }
        );
        dispatch(getMonitorLogsRequest({ monitorId }));

        promise.then(
            function (monitors) {
                dispatch(
                    getMonitorLogsSuccess({
                        monitorId,

                        logs: monitors.data.data,
                        skip,
                        limit,

                        count: monitors.data.count,
                    })
                );
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
                dispatch(
                    getMonitorLogsFailure({ monitorId, error: errors(error) })
                );
            }
        );
        return promise;
    };
}

export function getMonitorLogsSuccess(logs: $TSFixMe) {
    return {
        type: types.GET_MONITOR_LOGS_SUCCESS,
        payload: logs,
    };
}

export function getMonitorLogsRequest(logs: $TSFixMe) {
    return {
        type: types.GET_MONITOR_LOGS_REQUEST,
        payload: logs,
    };
}

export function getMonitorLogsFailure(error: $TSFixMe) {
    return {
        type: types.GET_MONITOR_LOGS_FAILURE,
        payload: error,
    };
}

// Fetch Lighthouse Logs list
export function fetchLighthouseLogs(
    projectId: $TSFixMe,
    monitorId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe,
    url: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = getApi(
            url
                ? `monitor/${projectId}/lighthouseLog/${monitorId}?limit=${limit}&skip=${skip}&url=${url}`
                : `monitor/${projectId}/lighthouseLog/${monitorId}?limit=${limit}&skip=${skip}`
        );
        dispatch(fetchLighthouseLogsRequest());

        promise.then(
            function (lighthouseLogs) {
                dispatch(
                    fetchLighthouseLogsSuccess({
                        projectId,
                        monitorId,

                        logs: lighthouseLogs.data,
                        skip,
                        limit,

                        count: lighthouseLogs.data.count,
                    })
                );
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
                dispatch(fetchLighthouseLogsFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function fetchLighthouseLogsRequest() {
    return {
        type: types.FETCH_LIGHTHOUSE_LOGS_REQUEST,
    };
}

export function fetchLighthouseLogsSuccess(lighthouseLogs: $TSFixMe) {
    return {
        type: types.FETCH_LIGHTHOUSE_LOGS_SUCCESS,
        payload: lighthouseLogs,
    };
}

export function fetchLighthouseLogsFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_LIGHTHOUSE_LOGS_FAILURE,
        payload: error,
    };
}

// Fetch Monitor Issue list
export function fetchMonitorIssue(projectId: $TSFixMe, issueId: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        const promise = getApi(
            `monitor/${projectId}/lighthouseIssue/${issueId}`
        );
        dispatch(fetchMonitorIssueRequest());

        promise.then(
            function (monitorIssue) {
                dispatch(fetchMonitorIssueSuccess(monitorIssue.data));
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
                dispatch(fetchMonitorIssueFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function fetchMonitorIssueRequest() {
    return {
        type: types.FETCH_MONITOR_ISSUE_REQUEST,
    };
}

export function fetchMonitorIssueSuccess(monitorIssue: $TSFixMe) {
    return {
        type: types.FETCH_MONITOR_ISSUE_SUCCESS,
        payload: monitorIssue,
    };
}

export function fetchMonitorIssueFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_MONITOR_ISSUE_FAILURE,
        payload: error,
    };
}

export function addSeat(projectId: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        const promise = postApi(`monitor/${projectId}/addseat`, {});
        dispatch(addSeatRequest());

        promise.then(
            function (monitor) {
                dispatch(createMonitorFailure(monitor.data));

                dispatch(addSeatSuccess(monitor.data));
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
                dispatch(addSeatFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function addSeatSuccess(message: $TSFixMe) {
    return {
        type: types.ADD_SEAT_SUCCESS,
        payload: message,
    };
}

export function addSeatRequest() {
    return {
        type: types.ADD_SEAT_REQUEST,
    };
}

export function addSeatFailure(error: $TSFixMe) {
    return {
        type: types.ADD_SEAT_FAILURE,
        payload: error,
    };
}

export function addSeatReset() {
    return {
        type: types.ADD_SEAT_RESET,
    };
}

export function addArrayField(val: $TSFixMe, insert: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch(change('NewMonitor', `${val}.field3`, true));
        dispatch(change('NewMonitor', `${val}.criteria`, insert));
    };
}

export function removeArrayField(val: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch(change('NewMonitor', `${val}.field3`, false));
        dispatch(autofill('NewMonitor', `${val}.criteria`, undefined));
    };
}

export function updateCriteriaField(
    field: $TSFixMe,
    val: $TSFixMe,
    noCriteria: $TSFixMe
) {
    if (noCriteria) {
        return function (dispatch: $TSFixMe) {
            dispatch(change('NewMonitor', field, val));
        };
    }
    return function (dispatch: $TSFixMe) {
        dispatch(change('NewMonitor', `${field}.criteria`, val));
    };
}

export function selectedProbe(val: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: types.SELECT_PROBE,
            payload: val,
        });
    };
}

export const closeBreachedMonitorSlaRequest = () => ({
    type: types.CLOSE_BREACHED_MONITOR_SLA_REQUEST,
});

export const closeBreachedMonitorSlaSuccess = (payload: $TSFixMe) => ({
    type: types.CLOSE_BREACHED_MONITOR_SLA_SUCCESS,
    payload,
});

export const closeBreachedMonitorSlaFailure = (error: $TSFixMe) => ({
    type: types.CLOSE_BREACHED_MONITOR_SLA_FAILURE,
    payload: error,
});

export const closeBreachedMonitorSla =
    (projectId: $TSFixMe, monitorId: $TSFixMe) =>
    async (dispatch: $TSFixMe) => {
        try {
            dispatch(closeBreachedMonitorSlaRequest());

            const response = await postApi(
                `monitor/${projectId}/closeSla/${monitorId}`
            );

            dispatch(closeBreachedMonitorSlaSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(closeBreachedMonitorSlaFailure(errorMsg));
        }
    };

export const fetchBreachedMonitorSlaRequest = () => ({
    type: types.FETCH_BREACHED_MONITOR_SLA_REQUEST,
});

export const fetchBreachedMonitorSlaSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_BREACHED_MONITOR_SLA_SUCCESS,
    payload,
});

export const fetchBreachedMonitorSlaFailure = (error: $TSFixMe) => ({
    type: types.FETCH_BREACHED_MONITOR_SLA_FAILURE,
    payload: error,
});

export const fetchBreachedMonitorSla =
    (projectId: $TSFixMe) => async (dispatch: $TSFixMe) => {
        try {
            dispatch(fetchBreachedMonitorSlaRequest());

            const response = await getApi(
                `monitor/${projectId}/monitorSlaBreaches`
            );

            dispatch(fetchBreachedMonitorSlaSuccess(response.data));
        } catch (error) {
            const errorMsg =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(fetchBreachedMonitorSlaFailure(errorMsg));
        }
    };
