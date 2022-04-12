import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/schedule';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';

// Get a payload of Schedules
export const resetSchedule = (): void => {
    return {
        type: types.SCHEDULE_FETCH_RESET,
    };
};

export const scheduleRequest = (promise: $TSFixMe): void => {
    return {
        type: types.SCHEDULE_FETCH_REQUEST,
        payload: promise,
    };
};

export const scheduleError = (error: ErrorPayload): void => {
    return {
        type: types.SCHEDULE_FETCH_FAILED,
        payload: error,
    };
};

export const scheduleSuccess = (schedule: $TSFixMe): void => {
    return {
        type: types.SCHEDULE_FETCH_SUCCESS,
        payload: schedule,
    };
};

// Calls the API to fetch Schedules.

export function fetchSchedules(
    projectId: string,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch): void {
        let promise = null;
        promise = BackendAPI.get(
            `schedule/${projectId}?skip=${skip || 0}&limit=${limit || 10}`
        );
        promise.then(
            function (schedule): void {
                dispatch(scheduleSuccess(schedule.data));
            },
            function (error): void {
                dispatch(scheduleError(error));
            }
        );

        return promise;
    };
}

// Get a payload of SubProject Schedules

export const resetSubProjectSchedule = (): void => {
    return {
        type: types.SUBPROJECT_SCHEDULE_FETCH_RESET,
    };
};

export const subProjectScheduleRequest = (promise: $TSFixMe): void => {
    return {
        type: types.SUBPROJECT_SCHEDULE_FETCH_REQUEST,
        payload: promise,
    };
};

export const subProjectScheduleError = (error: ErrorPayload): void => {
    return {
        type: types.SUBPROJECT_SCHEDULE_FETCH_FAILED,
        payload: error,
    };
};

export const subProjectScheduleSuccess = (schedule: $TSFixMe): void => {
    return {
        type: types.SUBPROJECT_SCHEDULE_FETCH_SUCCESS,
        payload: schedule,
    };
};

// Calls the API to fetch Schedules.

export const fetchSubProjectSchedules = (projectId: string): void => {
    return function (dispatch: Dispatch): void {
        let promise = null;
        promise = BackendAPI.get(`schedule/${projectId}/schedules`);

        dispatch(subProjectScheduleRequest());
        promise.then(
            function (schedule): void {
                dispatch(subProjectScheduleSuccess(schedule.data));
            },
            function (error): void {
                dispatch(subProjectScheduleError(error));
            }
        );

        return promise;
    };
};

export const resetProjectSchedule = (): void => {
    return {
        type: types.PROJECT_SCHEDULE_FETCH_RESET,
    };
};

export const projectScheduleRequest = (promise: $TSFixMe): void => {
    return {
        type: types.PROJECT_SCHEDULE_FETCH_REQUEST,
        payload: promise,
    };
};

export const projectScheduleError = (error: ErrorPayload): void => {
    return {
        type: types.PROJECT_SCHEDULE_FETCH_FAILED,
        payload: error,
    };
};

export const projectScheduleSuccess = (schedule: $TSFixMe): void => {
    return {
        type: types.PROJECT_SCHEDULE_FETCH_SUCCESS,
        payload: schedule,
    };
};

// Gets list of schedules in a project.

export function fetchProjectSchedule(
    projectId: string,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch): void {
        let promise = null;
        promise = BackendAPI.get(
            `schedule/${projectId}/schedule?skip=${skip}&limit=${limit}`
        );
        promise.then(
            function (schedule): void {
                const data = schedule.data;
                data.projectId = projectId;
                dispatch(projectScheduleSuccess(data));
            },
            function (error): void {
                dispatch(projectScheduleError(error));
            }
        );

        return promise;
    };
}

// Create a new schedule

export const createScheduleRequest = (): void => {
    return {
        type: types.CREATE_SCHEDULE_REQUEST,
    };
};

export const createScheduleError = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_SCHEDULE_FAILED,
        payload: error,
    };
};

export const createScheduleSuccess = (schedule: $TSFixMe): void => {
    return {
        type: types.CREATE_SCHEDULE_SUCCESS,
        payload: schedule,
    };
};

// Calls the API to create the schedule.

export const createSchedule = (projectId: string, values: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(`schedule/${projectId}`, values);

        dispatch(createScheduleRequest());

        promise.then(
            function (schedule): void {
                dispatch(createScheduleSuccess(schedule.data));
            },
            function (error): void {
                dispatch(createScheduleError(error));
            }
        );
        return promise;
    };
};

// Rename a Schedule

export const renameScheduleReset = (): void => {
    return {
        type: types.RENAME_SCHEDULE_RESET,
    };
};

export const renameScheduleRequest = (): void => {
    return {
        type: types.RENAME_SCHEDULE_REQUEST,
        payload: true,
    };
};

export const renameScheduleSuccess = (schedule: $TSFixMe): void => {
    return {
        type: types.RENAME_SCHEDULE_SUCCESS,
        payload: schedule.data,
    };
};

export const renameScheduleError = (error: ErrorPayload): void => {
    return {
        type: types.RENAME_SCHEDULE_FAILED,
        payload: error,
    };
};

export function renameSchedule(
    projectId: string,
    scheduleId: $TSFixMe,
    scheduleName: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put(`schedule/${projectId}/${scheduleId}`, {
            name: scheduleName,
        });

        dispatch(renameScheduleRequest());

        promise
            .then(
                function (schedule): void {
                    dispatch(renameScheduleSuccess(schedule));
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
                    dispatch(renameScheduleError(error));
                }
            )
            .then(function (): void {
                dispatch(renameScheduleReset());
            });

        return promise;
    };
}

// Delete a Schedule

export const deleteScheduleReset = (): void => {
    return {
        type: types.DELETE_SCHEDULE_RESET,
    };
};

export const deleteScheduleRequest = (): void => {
    return {
        type: types.DELETE_SCHEDULE_REQUEST,
        payload: true,
    };
};

export const deleteScheduleSuccess = (schedule: $TSFixMe): void => {
    return {
        type: types.DELETE_SCHEDULE_SUCCESS,
        payload: schedule.data,
    };
};

export const deleteProjectSchedules = (projectId: string): void => {
    return {
        type: types.DELETE_PROJECT_SCHEDULES,
        payload: projectId,
    };
};

export const deleteScheduleError = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_SCHEDULE_FAILED,
        payload: error,
    };
};

export const deleteSchedule = (
    projectId: string,
    scheduleId: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = delete `schedule/${projectId}/${scheduleId}`;

        dispatch(deleteScheduleRequest());

        promise
            .then(
                function (schedule): void {
                    const data = Object.assign(
                        {},
                        { scheduleId },

                        schedule.data
                    );

                    dispatch(fetchSchedules(projectId));
                    return dispatch(deleteScheduleSuccess({ data }));
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
                    dispatch(deleteScheduleError(error));
                }
            )
            .then(function (): void {
                dispatch(deleteScheduleReset());
            });

        return promise;
    };
};

// Add Monitors to Schedule

export const addMonitorReset = (): void => {
    return {
        type: types.ADD_MONITOR_RESET,
    };
};

export const addMonitorRequest = (): void => {
    return {
        type: types.ADD_MONITOR_REQUEST,
        payload: true,
    };
};

export const addMonitorSuccess = (schedule: $TSFixMe): void => {
    return {
        type: types.ADD_MONITOR_SUCCESS,
        payload: schedule.data,
    };
};

export const addMonitorError = (error: ErrorPayload): void => {
    return {
        type: types.ADD_MONITOR_FAILED,
        payload: error,
    };
};

export function addMonitors(
    projectId: string,
    scheduleId: $TSFixMe,
    data: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put(
            `schedule/${projectId}/${scheduleId}`,
            data
        );

        dispatch(addMonitorRequest());

        promise
            .then(
                function (schedule): void {
                    dispatch(addMonitorSuccess(schedule));
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
                    dispatch(addMonitorError(error));
                }
            )
            .then(function (): void {
                dispatch(addMonitorReset());
            });

        return promise;
    };
}

// Add Users to Schedule

export const addUserReset = (): void => {
    return {
        type: types.ADD_USER_RESET,
    };
};

export const addUserRequest = (): void => {
    return {
        type: types.ADD_USER_REQUEST,
        payload: true,
    };
};

export const addUserSuccess = (schedule: $TSFixMe): void => {
    return {
        type: types.ADD_USER_SUCCESS,
        payload: schedule.data,
    };
};

export const addUserError = (error: ErrorPayload): void => {
    return {
        type: types.ADD_USER_FAILED,
        payload: error,
    };
};

export function addUsers(
    projectId: string,
    scheduleId: $TSFixMe,
    data: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
            `schedule/${projectId}/${scheduleId}/addUsers`,
            data
        );

        dispatch(addUserRequest());

        promise
            .then(
                function (schedule): void {
                    dispatch(addUserSuccess(schedule));
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
                    dispatch(addUserError(error));
                }
            )
            .then(function (): void {
                dispatch(addUserReset());
            });

        return promise;
    };
}

// onCallAlertBox

export const escalationReset = (): void => {
    return {
        type: types.ESCALATION_RESET,
    };
};

export const escalationRequest = (): void => {
    return {
        type: types.ESCALATION_REQUEST,
        payload: true,
    };
};

export const escalationSuccess = (escalation: $TSFixMe): void => {
    return {
        type: types.ESCALATION_SUCCESS,
        payload: escalation,
    };
};

export const escalationError = (error: ErrorPayload): void => {
    return {
        type: types.ESCALATION_FAILED,
        payload: error,
    };
};

export function addEscalation(
    projectId: string,
    scheduleId: $TSFixMe,
    data: $TSFixMe
) {
    data = data.OnCallAlertBox;

    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
            `schedule/${projectId}/${scheduleId}/addescalation`,
            data
        );

        dispatch(escalationRequest());

        promise.then(
            function (escalation): void {
                dispatch(escalationSuccess(escalation));
            },
            function (error): void {
                dispatch(escalationError(error));
            }
        );

        return promise;
    };
}

export const getEscalation = (
    projectId: string,
    scheduleId: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `schedule/${projectId}/${scheduleId}/getescalation`
        );

        dispatch(escalationRequest());

        promise.then(
            function (escalation): void {
                dispatch(escalationSuccess(escalation.data));
            },
            function (error): void {
                dispatch(escalationError(error));
            }
        );

        return promise;
    };
};

// Implements pagination for Team Members table

export const paginateNext = (): void => {
    return {
        type: types.PAGINATE_NEXT,
    };
};

export const paginatePrev = (): void => {
    return {
        type: types.PAGINATE_PREV,
    };
};

export const paginateReset = (): void => {
    return {
        type: types.PAGINATE_RESET,
    };
};

export const paginate = (type: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        type === 'next' && dispatch(paginateNext());
        type === 'prev' && dispatch(paginatePrev());
        type === 'reset' && dispatch(paginateReset());
    };
};

export const userScheduleReset = (): void => {
    return {
        type: types.USER_SCHEDULE_RESET,
    };
};

export const userScheduleRequest = (): void => {
    return {
        type: types.USER_SCHEDULE_REQUEST,
    };
};

export const userScheduleSuccess = (userSchedule: $TSFixMe): void => {
    return {
        type: types.USER_SCHEDULE_SUCCESS,
        payload: userSchedule,
    };
};

export const userScheduleError = (error: ErrorPayload): void => {
    return {
        type: types.USER_SCHEDULE_FAILED,
        payload: error,
    };
};

export const fetchUserSchedule = (projectId: string, userId: string): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `schedule/${projectId}/${userId}/getescalations`
        );

        dispatch(userScheduleRequest());

        promise.then(
            function (schedule): void {
                dispatch(userScheduleSuccess(schedule.data));
            },
            function (error): void {
                dispatch(userScheduleError(error));
            }
        );

        return promise;
    };
};
