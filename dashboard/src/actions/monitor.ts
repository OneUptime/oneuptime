import { postApi, getApi, deleteApi, putApi } from '../api';
import { Dispatch } from 'redux';
import * as types from '../constants/monitor';
import errors from '../errors';

import { change, autofill } from 'redux-form';
//import { PricingPlan } from '../config';
//import { User } from '../config';
//import { upgradePlanEmpty, upgradeToEnterpriseMail } from '../actions/project';

//Monitor list
//props -> {name: '', type, data -> { data.url}}
export const fetchMonitors = (projectId: $TSFixMe, skip = 0, limit = 0) => {
    return function (dispatch: Dispatch) {
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
};

export const fetchMonitorsSuccess = (monitors: $TSFixMe) => {
    return {
        type: types.FETCH_MONITORS_SUCCESS,
        payload: monitors,
    };
};

export const fetchMonitorsRequest = () => {
    return {
        type: types.FETCH_MONITORS_REQUEST,
    };
};

export const fetchMonitorsFailure = (error: $TSFixMe) => {
    return {
        type: types.FETCH_MONITORS_FAILURE,
        payload: error,
    };
};

export const resetFetchMonitors = () => {
    return {
        type: types.FETCH_MONITORS_RESET,
    };
};

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
    return function (dispatch: Dispatch) {
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

export const fetchPaginatedMonitorsSuccess = (monitors: $TSFixMe) => {
    return {
        type: types.FETCH_PAGINATED_MONITORS_SUCCESS,
        payload: monitors,
    };
};

export const fetchPaginatedMonitorsRequest = (paginate: $TSFixMe) => {
    return {
        type: types.FETCH_PAGINATED_MONITORS_REQUEST,
        payload: paginate,
    };
};

export const fetchPaginatedMonitorsFailure = (error: $TSFixMe) => {
    return {
        type: types.FETCH_PAGINATED_MONITORS_FAILURE,
        payload: error,
    };
};

//Create new monitor
//props -> {name: '', type, data -> { data.url}}
export const createMonitor = (projectId: $TSFixMe, values: $TSFixMe) => {
    values.projectId = values.projectId._id || values.projectId;
    return function (dispatch: Dispatch) {
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
};

export const uploadIdentityFile = (projectId: $TSFixMe, file: $TSFixMe) => {
    return function (dispatch: Dispatch) {
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
};

export const uploadIdentityFileRequest = () => {
    return {
        type: types.UPLOAD_IDENTITY_FILE_REQUEST,
    };
};

export const logFile = (file: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({ type: types.UPLOAD_IDENTITY_FILE_SUCCESS, payload: file });
    };
};

export const resetFile = () => {
    return function (dispatch: Dispatch) {
        dispatch({ type: types.RESET_UPLOAD_IDENTITY_FILE });
    };
};

export const uploadConfigurationFileRequest = () => {
    return {
        type: types.UPLOAD_CONFIGURATION_FILE_REQUEST,
    };
};

export const logConfigFile = (file: $TSFixMe) => {
    return (dispatch: Dispatch) =>
        dispatch({
            type: types.UPLOAD_CONFIGURATION_FILE_SUCCESS,
            payload: file,
        });
};

export const resetConfigFile = () => {
    return (dispatch: Dispatch) =>
        dispatch({
            type: types.RESET_UPLOAD_CONFIGURATION_FILE,
        });
};

export const setConfigInputKey = (value: $TSFixMe) => {
    return {
        type: types.SET_CONFIGURATION_FILE_INPUT_KEY,
        payload: value,
    };
};

export const uploadConfigurationFile = (
    projectId: $TSFixMe,
    file: $TSFixMe
) => {
    return function (dispatch: Dispatch) {
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
};

export const setFileInputKey = (value: $TSFixMe) => {
    return {
        type: 'SET_IDENTITY_FILE_INPUT_KEY',
        payload: value,
    };
};

export const toggleEdit = (payload: $TSFixMe) => {
    return {
        type: types.TOGGLE_EDIT,
        payload,
    };
};

export const createMonitorSuccess = (newMonitor: $TSFixMe) => {
    return {
        type: types.CREATE_MONITOR_SUCCESS,
        payload: newMonitor,
    };
};

export const createMonitorRequest = () => {
    return {
        type: types.CREATE_MONITOR_REQUEST,
    };
};

export const createMonitorFailure = (error: $TSFixMe) => {
    return {
        type: types.CREATE_MONITOR_FAILURE,
        payload: error,
    };
};

export const resetCreateMonitor = () => {
    return {
        type: types.CREATE_MONITOR_RESET,
    };
};

//Edit new monitor
//props -> {name: '', type, data -> { data.url}}
export const editMonitor = (projectId: $TSFixMe, values: $TSFixMe) => {
    values.projectId = values.projectId._id || values.projectId || projectId;
    return function (dispatch: Dispatch) {
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
};

export const editMonitorSuccess = (newMonitor: $TSFixMe) => {
    if (newMonitor.lighthouseScanStatus === 'scanning') {
        fetchLighthouseLogs(newMonitor.projectId._id, newMonitor._id, 0, 5);
    }
    return {
        type: types.EDIT_MONITOR_SUCCESS,
        payload: newMonitor,
    };
};

export const editMonitorRequest = () => {
    return {
        type: types.EDIT_MONITOR_REQUEST,
    };
};

export const editMonitorFailure = (error: $TSFixMe) => {
    return {
        type: types.EDIT_MONITOR_FAILURE,
        payload: error,
    };
};

export const editMonitorSwitch = (index: $TSFixMe) => {
    return {
        type: types.EDIT_MONITOR_SWITCH,
        payload: index,
    };
};

export const resetEditMonitor = () => {
    return {
        type: types.EDIT_MONITOR_RESET,
    };
};

//Add new site url
//props -> siteUrl
export function addSiteUrl(
    monitorId: $TSFixMe,
    projectId: $TSFixMe,
    siteUrl: string
) {
    return function (dispatch: Dispatch) {
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
    siteUrl: string
) {
    return function (dispatch: Dispatch) {
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
export const deleteMonitor = (monitorId: $TSFixMe, projectId: $TSFixMe) => {
    return function (dispatch: Dispatch) {
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
};

export const deleteMonitorSuccess = (removedMonitorId: $TSFixMe) => {
    return {
        type: types.DELETE_MONITOR_SUCCESS,
        payload: removedMonitorId,
    };
};

export const deleteMonitorRequest = (monitorId: $TSFixMe) => {
    return {
        type: types.DELETE_MONITOR_REQUEST,
        payload: monitorId,
    };
};

export const deleteMonitorFailure = (error: $TSFixMe) => {
    return {
        type: types.DELETE_MONITOR_FAILURE,
        payload: error,
    };
};

export const deleteProjectMonitors = (projectId: $TSFixMe) => {
    return {
        type: types.DELETE_PROJECT_MONITORS,
        payload: projectId,
    };
};

//Disable a monitor
export const disableMonitor = (monitorId: $TSFixMe, projectId: $TSFixMe) => {
    return function (dispatch: Dispatch) {
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
};

export const disableMonitorSuccess = (monitorData: $TSFixMe) => {
    return {
        type: types.DISABLE_MONITOR_SUCCESS,
        payload: monitorData,
    };
};

export const disableMonitorRequest = (monitorId: $TSFixMe) => {
    return {
        type: types.DISABLE_MONITOR_REQUEST,
        payload: monitorId,
    };
};

export const disableMonitorFailure = (error: $TSFixMe) => {
    return {
        type: types.DISABLE_MONITOR_FAILURE,
        payload: error,
    };
};

// Change monitor's parent component
export const changeMonitorComponent = (
    projectId: $TSFixMe,
    monitorId: $TSFixMe,
    newComponentId: $TSFixMe
) => {
    return async (dispatch: Dispatch) => {
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
    return function (dispatch: Dispatch) {
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

export const fetchMonitorsIncidentsSuccess = (monitors: $TSFixMe) => {
    return {
        type: types.FETCH_MONITORS_INCIDENT_SUCCESS,
        payload: monitors,
    };
};

export const fetchMonitorsIncidentsRequest = (monitorId: $TSFixMe) => {
    return {
        type: types.FETCH_MONITORS_INCIDENT_REQUEST,
        payload: monitorId,
    };
};

export const fetchMonitorsIncidentsFailure = (error: $TSFixMe) => {
    return {
        type: types.FETCH_MONITORS_INCIDENT_FAILURE,
        payload: error,
    };
};

//Fetch Subscribers of monitors
export function fetchMonitorsSubscribers(
    projectId: $TSFixMe,
    monitorId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) {
    return function (dispatch: Dispatch) {
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

export const fetchMonitorsSubscribersSuccess = (monitors: $TSFixMe) => {
    return {
        type: types.FETCH_MONITORS_SUBSCRIBER_SUCCESS,
        payload: monitors,
    };
};

export const fetchMonitorsSubscribersRequest = (monitorId: $TSFixMe) => {
    return {
        type: types.FETCH_MONITORS_SUBSCRIBER_REQUEST,
        payload: monitorId,
    };
};

export const fetchMonitorsSubscribersFailure = (error: $TSFixMe) => {
    return {
        type: types.FETCH_MONITORS_SUBSCRIBER_FAILURE,
        payload: error,
    };
};

// Fetch Monitor Logs
export function fetchMonitorLogs(
    projectId: $TSFixMe,
    monitorId: $TSFixMe,
    startDate: $TSFixMe,
    endDate: $TSFixMe
) {
    return function (dispatch: Dispatch) {
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

export const updateDateRange = (startDate: $TSFixMe, endDate: $TSFixMe) => {
    return {
        type: 'UPDATE_DATE_RANGE',
        payload: { startDate, endDate },
    };
};

export const fetchMonitorLogsRequest = (payload: $TSFixMe) => {
    return {
        type: types.FETCH_MONITOR_LOGS_REQUEST,
        payload,
    };
};

export const fetchMonitorLogsSuccess = (monitorLogs: $TSFixMe) => {
    return {
        type: types.FETCH_MONITOR_LOGS_SUCCESS,
        payload: monitorLogs,
    };
};

export const fetchMonitorLogsFailure = (error: $TSFixMe) => {
    return {
        type: types.FETCH_MONITOR_LOGS_FAILURE,
        payload: error,
    };
};

// Fetch Monitor Statuses list
export function fetchMonitorStatuses(
    projectId: $TSFixMe,
    monitorId: $TSFixMe,
    startDate: $TSFixMe,
    endDate: $TSFixMe
) {
    return function (dispatch: Dispatch) {
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

export const fetchMonitorStatusesRequest = () => {
    return {
        type: types.FETCH_MONITOR_STATUSES_REQUEST,
    };
};

export const fetchMonitorStatusesSuccess = (monitorStatuses: $TSFixMe) => {
    return {
        type: types.FETCH_MONITOR_STATUSES_SUCCESS,
        payload: monitorStatuses,
    };
};

export const fetchMonitorStatusesFailure = (error: $TSFixMe) => {
    return {
        type: types.FETCH_MONITOR_STATUSES_FAILURE,
        payload: error,
    };
};

// Fetch Monitor Criteria
export const fetchMonitorCriteria = () => {
    return function (dispatch: Dispatch) {
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
};

export const fetchMonitorCriteriaRequest = () => {
    return {
        type: types.FETCH_MONITOR_CRITERIA_REQUEST,
    };
};

export const fetchMonitorCriteriaSuccess = (monitorCriteria: $TSFixMe) => {
    return {
        type: types.FETCH_MONITOR_CRITERIA_SUCCESS,
        payload: monitorCriteria,
    };
};

export const fetchMonitorCriteriaFailure = (error: $TSFixMe) => {
    return {
        type: types.FETCH_MONITOR_CRITERIA_FAILURE,
        payload: error,
    };
};

export function setMonitorCriteria(
    monitorName: $TSFixMe,
    monitorCategory: $TSFixMe,
    monitorSubProject: $TSFixMe,
    monitorCallSchedules: $TSFixMe,
    monitorSla: $TSFixMe,
    incidentCommunicationSla: $TSFixMe,
    monitorType: $TSFixMe
) {
    return function (dispatch: Dispatch) {
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
    return function (dispatch: Dispatch) {
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

export const getMonitorLogsSuccess = (logs: $TSFixMe) => {
    return {
        type: types.GET_MONITOR_LOGS_SUCCESS,
        payload: logs,
    };
};

export const getMonitorLogsRequest = (logs: $TSFixMe) => {
    return {
        type: types.GET_MONITOR_LOGS_REQUEST,
        payload: logs,
    };
};

export const getMonitorLogsFailure = (error: $TSFixMe) => {
    return {
        type: types.GET_MONITOR_LOGS_FAILURE,
        payload: error,
    };
};

// Fetch Lighthouse Logs list
export function fetchLighthouseLogs(
    projectId: $TSFixMe,
    monitorId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe,
    url: string
) {
    return function (dispatch: Dispatch) {
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

export const fetchLighthouseLogsRequest = () => {
    return {
        type: types.FETCH_LIGHTHOUSE_LOGS_REQUEST,
    };
};

export const fetchLighthouseLogsSuccess = (lighthouseLogs: $TSFixMe) => {
    return {
        type: types.FETCH_LIGHTHOUSE_LOGS_SUCCESS,
        payload: lighthouseLogs,
    };
};

export const fetchLighthouseLogsFailure = (error: $TSFixMe) => {
    return {
        type: types.FETCH_LIGHTHOUSE_LOGS_FAILURE,
        payload: error,
    };
};

// Fetch Monitor Issue list
export const fetchMonitorIssue = (projectId: $TSFixMe, issueId: $TSFixMe) => {
    return function (dispatch: Dispatch) {
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
};

export const fetchMonitorIssueRequest = () => {
    return {
        type: types.FETCH_MONITOR_ISSUE_REQUEST,
    };
};

export const fetchMonitorIssueSuccess = (monitorIssue: $TSFixMe) => {
    return {
        type: types.FETCH_MONITOR_ISSUE_SUCCESS,
        payload: monitorIssue,
    };
};

export const fetchMonitorIssueFailure = (error: $TSFixMe) => {
    return {
        type: types.FETCH_MONITOR_ISSUE_FAILURE,
        payload: error,
    };
};

export const addSeat = (projectId: $TSFixMe) => {
    return function (dispatch: Dispatch) {
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
};

export const addSeatSuccess = (message: $TSFixMe) => {
    return {
        type: types.ADD_SEAT_SUCCESS,
        payload: message,
    };
};

export const addSeatRequest = () => {
    return {
        type: types.ADD_SEAT_REQUEST,
    };
};

export const addSeatFailure = (error: $TSFixMe) => {
    return {
        type: types.ADD_SEAT_FAILURE,
        payload: error,
    };
};

export const addSeatReset = () => {
    return {
        type: types.ADD_SEAT_RESET,
    };
};

export const addArrayField = (val: $TSFixMe, insert: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch(change('NewMonitor', `${val}.field3`, true));
        dispatch(change('NewMonitor', `${val}.criteria`, insert));
    };
};

export const removeArrayField = (val: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch(change('NewMonitor', `${val}.field3`, false));
        dispatch(autofill('NewMonitor', `${val}.criteria`, undefined));
    };
};

export function updateCriteriaField(
    field: $TSFixMe,
    val: $TSFixMe,
    noCriteria: $TSFixMe
) {
    if (noCriteria) {
        return function (dispatch: Dispatch) {
            dispatch(change('NewMonitor', field, val));
        };
    }
    return function (dispatch: Dispatch) {
        dispatch(change('NewMonitor', `${field}.criteria`, val));
    };
}

export const selectedProbe = (val: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: types.SELECT_PROBE,
            payload: val,
        });
    };
};

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
    async (dispatch: Dispatch) => {
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
    (projectId: $TSFixMe) => async (dispatch: Dispatch) => {
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
