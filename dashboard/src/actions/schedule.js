import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/schedule';
import errors from '../errors';

// Get a payload of Schedules
export function resetSchedule() {
    return {
        type: types.SCHEDULE_FETCH_RESET,
    };
}

export function scheduleRequest(promise) {
    return {
        type: types.SCHEDULE_FETCH_REQUEST,
        payload: promise,
    };
}

export function scheduleError(error) {
    return {
        type: types.SCHEDULE_FETCH_FAILED,
        payload: error,
    };
}

export function scheduleSuccess(schedule) {
    return {
        type: types.SCHEDULE_FETCH_SUCCESS,
        payload: schedule,
    };
}

// Calls the API to fetch Schedules.

export function fetchSchedules(projectId, skip, limit) {
    return function(dispatch) {
        let promise = null;
        promise = getApi(
            `schedule/${projectId}?skip=${skip || 0}&limit=${limit || 10}`
        );
        promise.then(
            function(schedule) {
                dispatch(scheduleSuccess(schedule.data));
            },
            function(error) {
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
                dispatch(scheduleError(errors(error)));
            }
        );

        return promise;
    };
}

// Get a payload of SubProject Schedules

export function resetSubProjectSchedule() {
    return {
        type: types.SUBPROJECT_SCHEDULE_FETCH_RESET,
    };
}

export function subProjectScheduleRequest(promise) {
    return {
        type: types.SUBPROJECT_SCHEDULE_FETCH_REQUEST,
        payload: promise,
    };
}

export function subProjectScheduleError(error) {
    return {
        type: types.SUBPROJECT_SCHEDULE_FETCH_FAILED,
        payload: error,
    };
}

export function subProjectScheduleSuccess(schedule) {
    return {
        type: types.SUBPROJECT_SCHEDULE_FETCH_SUCCESS,
        payload: schedule,
    };
}

// Calls the API to fetch Schedules.

export function fetchSubProjectSchedules(projectId) {
    return function(dispatch) {
        let promise = null;
        promise = getApi(`schedule/${projectId}/schedules`);
        promise.then(
            function(schedule) {
                dispatch(subProjectScheduleSuccess(schedule.data));
            },
            function(error) {
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
                dispatch(subProjectScheduleError(errors(error)));
            }
        );

        return promise;
    };
}

export function resetProjectSchedule() {
    return {
        type: types.PROJECT_SCHEDULE_FETCH_RESET,
    };
}

export function projectScheduleRequest(promise) {
    return {
        type: types.PROJECT_SCHEDULE_FETCH_REQUEST,
        payload: promise,
    };
}

export function projectScheduleError(error) {
    return {
        type: types.PROJECT_SCHEDULE_FETCH_FAILED,
        payload: error,
    };
}

export function projectScheduleSuccess(schedule) {
    return {
        type: types.PROJECT_SCHEDULE_FETCH_SUCCESS,
        payload: schedule,
    };
}

// Gets list of schedules in a project.

export function fetchProjectSchedule(projectId, skip, limit) {
    return function(dispatch) {
        let promise = null;
        promise = getApi(
            `schedule/${projectId}/schedule?skip=${skip}&limit=${limit}`
        );
        promise.then(
            function(schedule) {
                const data = schedule.data;
                data.projectId = projectId;
                dispatch(projectScheduleSuccess(data));
            },
            function(error) {
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
                dispatch(projectScheduleError(errors(error)));
            }
        );

        return promise;
    };
}

// Create a new schedule

export function createScheduleRequest() {
    return {
        type: types.CREATE_SCHEDULE_REQUEST,
    };
}

export function createScheduleError(error) {
    return {
        type: types.CREATE_SCHEDULE_FAILED,
        payload: error,
    };
}

export function createScheduleSuccess(schedule) {
    return {
        type: types.CREATE_SCHEDULE_SUCCESS,
        payload: schedule,
    };
}

// Calls the API to create the schedule.

export function createSchedule(projectId, values) {
    return function(dispatch) {
        const promise = postApi(`schedule/${projectId}`, values);

        dispatch(createScheduleRequest());

        promise.then(
            function(schedule) {
                dispatch(createScheduleSuccess(schedule.data));
            },
            function(error) {
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
                dispatch(createScheduleError(errors(error)));
            }
        );
        return promise;
    };
}

// Rename a Schedule

export function renameScheduleReset() {
    return {
        type: types.RENAME_SCHEDULE_RESET,
    };
}

export function renameScheduleRequest() {
    return {
        type: types.RENAME_SCHEDULE_REQUEST,
        payload: true,
    };
}

export function renameScheduleSuccess(schedule) {
    return {
        type: types.RENAME_SCHEDULE_SUCCESS,
        payload: schedule.data,
    };
}

export function renameScheduleError(error) {
    return {
        type: types.RENAME_SCHEDULE_FAILED,
        payload: error,
    };
}

export function renameSchedule(projectId, scheduleId, scheduleName) {
    return function(dispatch) {
        const promise = putApi(`schedule/${projectId}/${scheduleId}`, {
            name: scheduleName,
        });

        dispatch(renameScheduleRequest());

        promise
            .then(
                function(schedule) {
                    dispatch(renameScheduleSuccess(schedule));
                },
                function(error) {
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
                    dispatch(renameScheduleError(errors(error)));
                }
            )
            .then(function() {
                dispatch(renameScheduleReset());
            });

        return promise;
    };
}

// Delete a Schedule

export function deleteScheduleReset() {
    return {
        type: types.DELETE_SCHEDULE_RESET,
    };
}

export function deleteScheduleRequest() {
    return {
        type: types.DELETE_SCHEDULE_REQUEST,
        payload: true,
    };
}

export function deleteScheduleSuccess(schedule) {
    return {
        type: types.DELETE_SCHEDULE_SUCCESS,
        payload: schedule.data,
    };
}

export function deleteProjectSchedules(projectId) {
    return {
        type: types.DELETE_PROJECT_SCHEDULES,
        payload: projectId,
    };
}

export function deleteScheduleError(error) {
    return {
        type: types.DELETE_SCHEDULE_FAILED,
        payload: error,
    };
}

export function deleteSchedule(projectId, scheduleId) {
    return function(dispatch) {
        const promise = deleteApi(`schedule/${projectId}/${scheduleId}`);

        dispatch(deleteScheduleRequest());

        promise
            .then(
                function(schedule) {
                    const data = Object.assign(
                        {},
                        { scheduleId },
                        schedule.data
                    );
                    dispatch(fetchSchedules(projectId));
                    return dispatch(deleteScheduleSuccess({ data }));
                },
                function(error) {
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
                    dispatch(deleteScheduleError(errors(error)));
                }
            )
            .then(function() {
                dispatch(deleteScheduleReset());
            });

        return promise;
    };
}

// Add Monitors to Schedule

export function addMonitorReset() {
    return {
        type: types.ADD_MONITOR_RESET,
    };
}

export function addMonitorRequest() {
    return {
        type: types.ADD_MONITOR_REQUEST,
        payload: true,
    };
}

export function addMonitorSuccess(schedule) {
    return {
        type: types.ADD_MONITOR_SUCCESS,
        payload: schedule.data,
    };
}

export function addMonitorError(error) {
    return {
        type: types.ADD_MONITOR_FAILED,
        payload: error,
    };
}

export function addMonitors(projectId, scheduleId, data) {
    return function(dispatch) {
        const promise = putApi(`schedule/${projectId}/${scheduleId}`, data);

        dispatch(addMonitorRequest());

        promise
            .then(
                function(schedule) {
                    dispatch(addMonitorSuccess(schedule));
                },
                function(error) {
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
                    dispatch(addMonitorError(errors(error)));
                }
            )
            .then(function() {
                dispatch(addMonitorReset());
            });

        return promise;
    };
}

// Add Users to Schedule

export function addUserReset() {
    return {
        type: types.ADD_USER_RESET,
    };
}

export function addUserRequest() {
    return {
        type: types.ADD_USER_REQUEST,
        payload: true,
    };
}

export function addUserSuccess(schedule) {
    return {
        type: types.ADD_USER_SUCCESS,
        payload: schedule.data,
    };
}

export function addUserError(error) {
    return {
        type: types.ADD_USER_FAILED,
        payload: error,
    };
}

export function addUsers(projectId, scheduleId, data) {
    return function(dispatch) {
        const promise = postApi(
            `schedule/${projectId}/${scheduleId}/addUsers`,
            data
        );

        dispatch(addUserRequest());

        promise
            .then(
                function(schedule) {
                    dispatch(addUserSuccess(schedule));
                },
                function(error) {
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
                    dispatch(addUserError(errors(error)));
                }
            )
            .then(function() {
                dispatch(addUserReset());
            });

        return promise;
    };
}

// onCallAlertBox

export function escalationReset() {
    return {
        type: types.ESCALATION_RESET,
    };
}

export function escalationRequest() {
    return {
        type: types.ESCALATION_REQUEST,
        payload: true,
    };
}

export function escalationSuccess(escalation) {
    return {
        type: types.ESCALATION_SUCCESS,
        payload: escalation,
    };
}

export function escalationError(error) {
    return {
        type: types.ESCALATION_FAILED,
        payload: error,
    };
}

export function addEscalation(projectId, scheduleId, data) {
    data = data.OnCallAlertBox;

    return function(dispatch) {
        const promise = postApi(
            `schedule/${projectId}/${scheduleId}/addescalation`,
            data
        );

        dispatch(escalationRequest());

        promise.then(
            function(escalation) {
                dispatch(escalationSuccess(escalation));
            },
            function(error) {
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
                dispatch(escalationError(errors(error)));
            }
        );

        return promise;
    };
}

export function getEscalation(projectId, scheduleId) {
    return function(dispatch) {
        const promise = getApi(
            `schedule/${projectId}/${scheduleId}/getescalation`
        );

        dispatch(escalationRequest());

        promise.then(
            function(escalation) {
                dispatch(escalationSuccess(escalation.data));
            },
            function(error) {
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
                dispatch(escalationError(errors(error)));
            }
        );

        return promise;
    };
}

// Implements pagination for Team Members table

export function paginateNext() {
    return {
        type: types.PAGINATE_NEXT,
    };
}

export function paginatePrev() {
    return {
        type: types.PAGINATE_PREV,
    };
}

export function paginateReset() {
    return {
        type: types.PAGINATE_RESET,
    };
}

export function paginate(type) {
    return function(dispatch) {
        type === 'next' && dispatch(paginateNext());
        type === 'prev' && dispatch(paginatePrev());
        type === 'reset' && dispatch(paginateReset());
    };
}
