import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/monitor';
import Route from 'Common/Types/api/route';
import { change, autofill } from 'redux-form';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';

//import { PricingPlan } from '../config';
//import { User } from '../config';
//import { upgradePlanEmpty, upgradeToEnterpriseMail } from '../actions/project';

//Monitor list
//props -> {name: '', type, data -> { data.url}}
export const fetchMonitors = (projectId: string, skip = 0, limit = 0): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `monitor/${projectId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchMonitorsRequest());

        promise.then(
            function (monitors): void {
                dispatch(fetchMonitorsSuccess(monitors.data));
            },
            function (error): void {
                dispatch(fetchMonitorsFailure(error));
            }
        );

        return promise;
    };
};

export const fetchMonitorsSuccess = (monitors: $TSFixMe): void => {
    return {
        type: types.FETCH_MONITORS_SUCCESS,
        payload: monitors,
    };
};

export const fetchMonitorsRequest = (): void => {
    return {
        type: types.FETCH_MONITORS_REQUEST,
    };
};

export const fetchMonitorsFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_MONITORS_FAILURE,
        payload: error,
    };
};

export const resetFetchMonitors = (): void => {
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
    return function (dispatch: Dispatch): void {
        let url = `monitor/${projectId}/paginated?skip=${skip}&limit=${limit}&componentId=${componentId}`;
        if (componentSlug) {
            url = `monitor/${projectId}/paginated?skip=${skip}&limit=${limit}&componentSlug=${componentSlug}`;
        }
        const promise = BackendAPI.get(url);
        dispatch(fetchPaginatedMonitorsRequest(paginate));

        promise.then(
            function (monitors): void {
                dispatch(fetchPaginatedMonitorsSuccess(monitors.data));
            },
            function (error): void {
                dispatch(fetchPaginatedMonitorsFailure(error));
            }
        );

        return promise;
    };
}

export const fetchPaginatedMonitorsSuccess = (monitors: $TSFixMe): void => {
    return {
        type: types.FETCH_PAGINATED_MONITORS_SUCCESS,
        payload: monitors,
    };
};

export const fetchPaginatedMonitorsRequest = (paginate: $TSFixMe): void => {
    return {
        type: types.FETCH_PAGINATED_MONITORS_REQUEST,
        payload: paginate,
    };
};

export const fetchPaginatedMonitorsFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_PAGINATED_MONITORS_FAILURE,
        payload: error,
    };
};

//Create new monitor
//props -> {name: '', type, data -> { data.url}}
export const createMonitor = (projectId: string, values: $TSFixMe): void => {
    values.projectId = values.projectId._id || values.projectId;
    return function (dispatch: Dispatch): void {
        dispatch(createMonitorRequest());
        const promise = BackendAPI.post(`monitor/${projectId}`, values);
        promise.then(
            function (monitor): void {
                dispatch(createMonitorSuccess(monitor.data));
                dispatch(resetFile());

                return monitor.data;
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
                dispatch(createMonitorFailure(error));
            }
        );

        return promise;
    };
};

export const uploadIdentityFile = (projectId: string, file: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const data = new FormData();
        if (file) {
            data.append('identityFile', file);

            const promise = BackendAPI.post(
                `monitor/${projectId}/identityFile`,
                data
            );
            dispatch(uploadIdentityFileRequest());
            promise.then(
                function (response): void {
                    const data = response.data;
                    dispatch(logFile(data.identityFile));
                    return data;
                },
                function (error): void {
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

export const uploadIdentityFileRequest = (): void => {
    return {
        type: types.UPLOAD_IDENTITY_FILE_REQUEST,
    };
};

export const logFile = (file: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({ type: types.UPLOAD_IDENTITY_FILE_SUCCESS, payload: file });
    };
};

export const resetFile = (): void => {
    return function (dispatch: Dispatch): void {
        dispatch({ type: types.RESET_UPLOAD_IDENTITY_FILE });
    };
};

export const uploadConfigurationFileRequest = (): void => {
    return {
        type: types.UPLOAD_CONFIGURATION_FILE_REQUEST,
    };
};

export const logConfigFile = (file: $TSFixMe): void => {
    return (dispatch: Dispatch) =>
        dispatch({
            type: types.UPLOAD_CONFIGURATION_FILE_SUCCESS,
            payload: file,
        });
};

export const resetConfigFile = (): void => {
    return (dispatch: Dispatch) =>
        dispatch({
            type: types.RESET_UPLOAD_CONFIGURATION_FILE,
        });
};

export const setConfigInputKey = (value: $TSFixMe): void => {
    return {
        type: types.SET_CONFIGURATION_FILE_INPUT_KEY,
        payload: value,
    };
};

export const uploadConfigurationFile = (
    projectId: string,
    file: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const data = new FormData();
        if (file) {
            data.append('configurationFile', file);

            const promise = BackendAPI.post(
                `monitor/${projectId}/configurationFile`,
                data
            );
            dispatch(uploadConfigurationFileRequest());
            promise.then(
                function (response): void {
                    const data = response.data;
                    dispatch(logConfigFile(data.configurationFile));
                    return data;
                },
                function (error): void {
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

export const setFileInputKey = (value: $TSFixMe): void => {
    return {
        type: 'SET_IDENTITY_FILE_INPUT_KEY',
        payload: value,
    };
};

export const toggleEdit = (payload: $TSFixMe): void => {
    return {
        type: types.TOGGLE_EDIT,
        payload,
    };
};

export const createMonitorSuccess = (newMonitor: $TSFixMe): void => {
    return {
        type: types.CREATE_MONITOR_SUCCESS,
        payload: newMonitor,
    };
};

export const createMonitorRequest = (): void => {
    return {
        type: types.CREATE_MONITOR_REQUEST,
    };
};

export const createMonitorFailure = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_MONITOR_FAILURE,
        payload: error,
    };
};

export const resetCreateMonitor = (): void => {
    return {
        type: types.CREATE_MONITOR_RESET,
    };
};

//Edit new monitor
//props -> {name: '', type, data -> { data.url}}
export const editMonitor = (projectId: string, values: $TSFixMe): void => {
    values.projectId = values.projectId._id || values.projectId || projectId;
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put(
            `monitor/${projectId}/${values._id}`,
            values
        );
        if (
            !values.lighthouseScanStatus ||
            (values.lighthouseScanStatus &&
                values.lighthouseScanStatus !== 'scan')
        ) {
            dispatch(editMonitorRequest());
        }
        promise.then(
            function (monitor): void {
                dispatch(editMonitorSuccess(monitor.data));
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
                dispatch(editMonitorFailure(error));
            }
        );

        return promise;
    };
};

export const editMonitorSuccess = (newMonitor: $TSFixMe): void => {
    if (newMonitor.lighthouseScanStatus === 'scanning') {
        fetchLighthouseLogs(newMonitor.projectId._id, newMonitor._id, 0, 5);
    }
    return {
        type: types.EDIT_MONITOR_SUCCESS,
        payload: newMonitor,
    };
};

export const editMonitorRequest = (): void => {
    return {
        type: types.EDIT_MONITOR_REQUEST,
    };
};

export const editMonitorFailure = (error: ErrorPayload): void => {
    return {
        type: types.EDIT_MONITOR_FAILURE,
        payload: error,
    };
};

export const editMonitorSwitch = (index: $TSFixMe): void => {
    return {
        type: types.EDIT_MONITOR_SWITCH,
        payload: index,
    };
};

export const resetEditMonitor = (): void => {
    return {
        type: types.EDIT_MONITOR_RESET,
    };
};

//Add new site url
//props -> siteUrl
export function addSiteUrl(
    monitorId: $TSFixMe,
    projectId: string,
    siteUrl: URL
) {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
            `monitor/${projectId}/siteUrl/${monitorId}`,
            {
                siteUrl,
            }
        );
        dispatch(editMonitorRequest());

        promise.then(
            function (monitor): void {
                dispatch(editMonitorSuccess(monitor.data));
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
                dispatch(editMonitorFailure(error));
            }
        );

        return promise;
    };
}

export function deleteSiteUrl(
    monitorId: $TSFixMe,
    projectId: string,
    siteUrl: URL
) {
    return function (dispatch: Dispatch): void {
        const promise = delete (`monitor/${projectId}/siteUrl/${monitorId}`,
        {
            siteUrl,
        });
        dispatch(editMonitorRequest());

        promise.then(
            function (monitor): void {
                dispatch(editMonitorSuccess(monitor.data));
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
                dispatch(editMonitorFailure(error));
            }
        );

        return promise;
    };
}

//Delete a monitor
//props -> {name: '', type, data -> { data.url}}
export const deleteMonitor = (monitorId: $TSFixMe, projectId: string): void => {
    return function (dispatch: Dispatch): void {
        const promise = delete `monitor/${projectId}/${monitorId}`;
        dispatch(deleteMonitorRequest(monitorId));

        promise.then(
            function (monitor): void {
                dispatch(deleteMonitorSuccess(monitor.data._id));
            },
            function (error): void {
                dispatch(deleteMonitorFailure({ error: error, monitorId }));
            }
        );

        return promise;
    };
};

export const deleteMonitorSuccess = (removedMonitorId: $TSFixMe): void => {
    return {
        type: types.DELETE_MONITOR_SUCCESS,
        payload: removedMonitorId,
    };
};

export const deleteMonitorRequest = (monitorId: $TSFixMe): void => {
    return {
        type: types.DELETE_MONITOR_REQUEST,
        payload: monitorId,
    };
};

export const deleteMonitorFailure = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_MONITOR_FAILURE,
        payload: error,
    };
};

export const deleteProjectMonitors = (projectId: string): void => {
    return {
        type: types.DELETE_PROJECT_MONITORS,
        payload: projectId,
    };
};

//Disable a monitor
export const disableMonitor = (
    monitorId: $TSFixMe,
    projectId: string
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
            `monitor/${projectId}/disableMonitor/${monitorId}`,
            {
                monitorId,
            }
        );
        dispatch(disableMonitorRequest(monitorId));

        promise.then(
            function (monitor): void {
                dispatch(
                    disableMonitorSuccess({
                        monitorId: monitor.data._id,

                        disable: monitor.data.disabled,
                    })
                );
            },
            function (error): void {
                dispatch(disableMonitorFailure({ error: error, monitorId }));
            }
        );

        return promise;
    };
};

export const disableMonitorSuccess = (monitorData: $TSFixMe): void => {
    return {
        type: types.DISABLE_MONITOR_SUCCESS,
        payload: monitorData,
    };
};

export const disableMonitorRequest = (monitorId: $TSFixMe): void => {
    return {
        type: types.DISABLE_MONITOR_REQUEST,
        payload: monitorId,
    };
};

export const disableMonitorFailure = (error: ErrorPayload): void => {
    return {
        type: types.DISABLE_MONITOR_FAILURE,
        payload: error,
    };
};

// Change monitor's parent component
export const changeMonitorComponent = (
    projectId: string,
    monitorId: $TSFixMe,
    newComponentId: $TSFixMe
): void => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(changeMonitorComponentRequest(monitorId));
            const monitor = await BackendAPI.post(
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

export const changeMonitorComponentRequest = (monitorId: $TSFixMe): void => {
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

export const changeMonitorComponentFailure = (error: ErrorPayload): void => {
    return {
        type: types.CHANGE_MONITOR_COMPONENT_FAILURE,
        payload: error,
    };
};

//Fetch Incidents of monitors
//props -> {name: '', type, data -> { data.url}}
export function fetchMonitorsIncidents(
    projectId: string,
    monitorId: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
            `incident/${projectId}/monitor/${monitorId}`,
            {
                limit,
                skip,
            }
        );
        dispatch(fetchMonitorsIncidentsRequest(monitorId));

        promise.then(
            function (monitors): void {
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
            function (error): void {
                dispatch(fetchMonitorsIncidentsFailure(error));
            }
        );

        return promise;
    };
}

export const fetchMonitorsIncidentsSuccess = (monitors: $TSFixMe): void => {
    return {
        type: types.FETCH_MONITORS_INCIDENT_SUCCESS,
        payload: monitors,
    };
};

export const fetchMonitorsIncidentsRequest = (monitorId: $TSFixMe): void => {
    return {
        type: types.FETCH_MONITORS_INCIDENT_REQUEST,
        payload: monitorId,
    };
};

export const fetchMonitorsIncidentsFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_MONITORS_INCIDENT_FAILURE,
        payload: error,
    };
};

//Fetch Subscribers of monitors
export function fetchMonitorsSubscribers(
    projectId: string,
    monitorId: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `subscriber/${projectId}/monitor/${monitorId}?limit=${limit}&skip=${skip}`
        );
        dispatch(fetchMonitorsSubscribersRequest(monitorId));

        promise.then(
            function (subscribers): void {
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
            function (error): void {
                dispatch(fetchMonitorsSubscribersFailure(error));
            }
        );

        return promise;
    };
}

export const fetchMonitorsSubscribersSuccess = (monitors: $TSFixMe): void => {
    return {
        type: types.FETCH_MONITORS_SUBSCRIBER_SUCCESS,
        payload: monitors,
    };
};

export const fetchMonitorsSubscribersRequest = (monitorId: $TSFixMe): void => {
    return {
        type: types.FETCH_MONITORS_SUBSCRIBER_REQUEST,
        payload: monitorId,
    };
};

export const fetchMonitorsSubscribersFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_MONITORS_SUBSCRIBER_FAILURE,
        payload: error,
    };
};

// Fetch Monitor Logs
export function fetchMonitorLogs(
    projectId: string,
    monitorId: $TSFixMe,
    startDate: $TSFixMe,
    endDate: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
            `monitor/${projectId}/monitorLog/${monitorId}`,
            { startDate, endDate }
        );
        dispatch(fetchMonitorLogsRequest(monitorId));
        dispatch(updateDateRange(startDate, endDate));

        promise.then(
            function (monitorLogs): void {
                dispatch(
                    fetchMonitorLogsSuccess({
                        projectId,
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

export const updateDateRange = (
    startDate: $TSFixMe,
    endDate: $TSFixMe
): void => {
    return {
        type: 'UPDATE_DATE_RANGE',
        payload: { startDate, endDate },
    };
};

export const fetchMonitorLogsRequest = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_MONITOR_LOGS_REQUEST,
        payload,
    };
};

export const fetchMonitorLogsSuccess = (monitorLogs: $TSFixMe): void => {
    return {
        type: types.FETCH_MONITOR_LOGS_SUCCESS,
        payload: monitorLogs,
    };
};

export const fetchMonitorLogsFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_MONITOR_LOGS_FAILURE,
        payload: error,
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
            `monitor/${projectId}/monitorStatuses/${monitorId}`,
            { startDate, endDate }
        );
        dispatch(fetchMonitorStatusesRequest());

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

export const fetchMonitorStatusesRequest = (): void => {
    return {
        type: types.FETCH_MONITOR_STATUSES_REQUEST,
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

// Fetch Monitor Criteria
export const fetchMonitorCriteria = (): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(new Route('monitorCriteria'));
        dispatch(fetchMonitorCriteriaRequest());

        promise.then(
            function (monitorCriteria): void {
                dispatch(fetchMonitorCriteriaSuccess(monitorCriteria));
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
                dispatch(fetchMonitorCriteriaFailure(error));
            }
        );

        return promise;
    };
};

export const fetchMonitorCriteriaRequest = (): void => {
    return {
        type: types.FETCH_MONITOR_CRITERIA_REQUEST,
    };
};

export const fetchMonitorCriteriaSuccess = (
    monitorCriteria: $TSFixMe
): void => {
    return {
        type: types.FETCH_MONITOR_CRITERIA_SUCCESS,
        payload: monitorCriteria,
    };
};

export const fetchMonitorCriteriaFailure = (error: ErrorPayload): void => {
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
    return function (dispatch: Dispatch): void {
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
    projectId: string,
    monitorId: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber,
    startDate: $TSFixMe,
    endDate: $TSFixMe,
    probeValue: $TSFixMe,
    incidentId: $TSFixMe,
    type: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
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
            function (monitors): void {
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
            function (error): void {
                dispatch(getMonitorLogsFailure({ monitorId, error: error }));
            }
        );
        return promise;
    };
}

export const getMonitorLogsSuccess = (logs: $TSFixMe): void => {
    return {
        type: types.GET_MONITOR_LOGS_SUCCESS,
        payload: logs,
    };
};

export const getMonitorLogsRequest = (logs: $TSFixMe): void => {
    return {
        type: types.GET_MONITOR_LOGS_REQUEST,
        payload: logs,
    };
};

export const getMonitorLogsFailure = (error: ErrorPayload): void => {
    return {
        type: types.GET_MONITOR_LOGS_FAILURE,
        payload: error,
    };
};

// Fetch Lighthouse Logs list
export function fetchLighthouseLogs(
    projectId: string,
    monitorId: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber,
    url: URL
) {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            url
                ? `monitor/${projectId}/lighthouseLog/${monitorId}?limit=${limit}&skip=${skip}&url=${url}`
                : `monitor/${projectId}/lighthouseLog/${monitorId}?limit=${limit}&skip=${skip}`
        );
        dispatch(fetchLighthouseLogsRequest());

        promise.then(
            function (lighthouseLogs): void {
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
            function (error): void {
                dispatch(fetchLighthouseLogsFailure(error));
            }
        );

        return promise;
    };
}

export const fetchLighthouseLogsRequest = (): void => {
    return {
        type: types.FETCH_LIGHTHOUSE_LOGS_REQUEST,
    };
};

export const fetchLighthouseLogsSuccess = (lighthouseLogs: $TSFixMe): void => {
    return {
        type: types.FETCH_LIGHTHOUSE_LOGS_SUCCESS,
        payload: lighthouseLogs,
    };
};

export const fetchLighthouseLogsFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_LIGHTHOUSE_LOGS_FAILURE,
        payload: error,
    };
};

// Fetch Monitor Issue list
export const fetchMonitorIssue = (
    projectId: string,
    issueId: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `monitor/${projectId}/lighthouseIssue/${issueId}`
        );
        dispatch(fetchMonitorIssueRequest());

        promise.then(
            function (monitorIssue): void {
                dispatch(fetchMonitorIssueSuccess(monitorIssue.data));
            },
            function (error): void {
                dispatch(fetchMonitorIssueFailure(error));
            }
        );

        return promise;
    };
};

export const fetchMonitorIssueRequest = (): void => {
    return {
        type: types.FETCH_MONITOR_ISSUE_REQUEST,
    };
};

export const fetchMonitorIssueSuccess = (monitorIssue: $TSFixMe): void => {
    return {
        type: types.FETCH_MONITOR_ISSUE_SUCCESS,
        payload: monitorIssue,
    };
};

export const fetchMonitorIssueFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_MONITOR_ISSUE_FAILURE,
        payload: error,
    };
};

export const addSeat = (projectId: string): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(`monitor/${projectId}/addseat`, {});
        dispatch(addSeatRequest());

        promise.then(
            function (monitor): void {
                dispatch(createMonitorFailure(monitor.data));

                dispatch(addSeatSuccess(monitor.data));
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
                dispatch(addSeatFailure(error));
            }
        );

        return promise;
    };
};

export const addSeatSuccess = (message: $TSFixMe): void => {
    return {
        type: types.ADD_SEAT_SUCCESS,
        payload: message,
    };
};

export const addSeatRequest = (): void => {
    return {
        type: types.ADD_SEAT_REQUEST,
    };
};

export const addSeatFailure = (error: ErrorPayload): void => {
    return {
        type: types.ADD_SEAT_FAILURE,
        payload: error,
    };
};

export const addSeatReset = (): void => {
    return {
        type: types.ADD_SEAT_RESET,
    };
};

export const addArrayField = (val: $TSFixMe, insert: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch(change('NewMonitor', `${val}.field3`, true));
        dispatch(change('NewMonitor', `${val}.criteria`, insert));
    };
};

export const removeArrayField = (val: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
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
        return function (dispatch: Dispatch): void {
            dispatch(change('NewMonitor', field, val));
        };
    }
    return function (dispatch: Dispatch): void {
        dispatch(change('NewMonitor', `${field}.criteria`, val));
    };
}

export const selectedProbe = (val: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: types.SELECT_PROBE,
            payload: val,
        });
    };
};

export const closeBreachedMonitorSlaRequest = (): void => ({
    type: types.CLOSE_BREACHED_MONITOR_SLA_REQUEST,
});

export const closeBreachedMonitorSlaSuccess = (payload: $TSFixMe): void => ({
    type: types.CLOSE_BREACHED_MONITOR_SLA_SUCCESS,
    payload,
});

export const closeBreachedMonitorSlaFailure = (error: ErrorPayload): void => ({
    type: types.CLOSE_BREACHED_MONITOR_SLA_FAILURE,
    payload: error,
});

export const closeBreachedMonitorSla =
    (projectId: string, monitorId: $TSFixMe) => async (dispatch: Dispatch) => {
        try {
            dispatch(closeBreachedMonitorSlaRequest());

            const response = await BackendAPI.post(
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

export const fetchBreachedMonitorSlaRequest = (): void => ({
    type: types.FETCH_BREACHED_MONITOR_SLA_REQUEST,
});

export const fetchBreachedMonitorSlaSuccess = (payload: $TSFixMe): void => ({
    type: types.FETCH_BREACHED_MONITOR_SLA_SUCCESS,
    payload,
});

export const fetchBreachedMonitorSlaFailure = (error: ErrorPayload): void => ({
    type: types.FETCH_BREACHED_MONITOR_SLA_FAILURE,
    payload: error,
});

export const fetchBreachedMonitorSla =
    (projectId: string) => async (dispatch: Dispatch) => {
        try {
            dispatch(fetchBreachedMonitorSlaRequest());

            const response = await BackendAPI.get(
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
