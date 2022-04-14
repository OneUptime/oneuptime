import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/schedule';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';

// Get a payload of Schedules
export const resetSchedule: Function = (): void => {
    return {
        type: types.SCHEDULE_FETCH_RESET,
    };
};

export const scheduleRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.SCHEDULE_FETCH_REQUEST,
        payload: promise,
    };
};

export const scheduleError: Function = (error: ErrorPayload): void => {
    return {
        type: types.SCHEDULE_FETCH_FAILED,
        payload: error,
    };
};

export const scheduleSuccess: Function = (schedule: $TSFixMe): void => {
    return {
        type: types.SCHEDULE_FETCH_SUCCESS,
        payload: schedule,
    };
};

// Calls the API to fetch Schedules.

export function fetchSchedules(
    projectId: ObjectID,
    skip: PositiveNumber,
    limit: PositiveNumber
): void {
    return function (dispatch: Dispatch): void {
        let promise = null;
        promise = BackendAPI.get(
            `schedule/${projectId}?skip=${skip || 0}&limit=${limit || 10}`
        );
        promise.then(
            (schedule): void => {
                dispatch(scheduleSuccess(schedule.data));
            },
            (error): void => {
                dispatch(scheduleError(error));
            }
        );

        return promise;
    };
}

// Get a payload of SubProject Schedules

export const resetSubProjectSchedule: Function = (): void => {
    return {
        type: types.SUBPROJECT_SCHEDULE_FETCH_RESET,
    };
};

export const subProjectScheduleRequest: Function = (
    promise: $TSFixMe
): void => {
    return {
        type: types.SUBPROJECT_SCHEDULE_FETCH_REQUEST,
        payload: promise,
    };
};

export const subProjectScheduleError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.SUBPROJECT_SCHEDULE_FETCH_FAILED,
        payload: error,
    };
};

export const subProjectScheduleSuccess: Function = (
    schedule: $TSFixMe
): void => {
    return {
        type: types.SUBPROJECT_SCHEDULE_FETCH_SUCCESS,
        payload: schedule,
    };
};

// Calls the API to fetch Schedules.

export const fetchSubProjectSchedules: Function = (
    projectId: ObjectID
): void => {
    return function (dispatch: Dispatch): void {
        let promise = null;
        promise = BackendAPI.get(`schedule/${projectId}/schedules`);

        dispatch(subProjectScheduleRequest());
        promise.then(
            (schedule): void => {
                dispatch(subProjectScheduleSuccess(schedule.data));
            },
            (error): void => {
                dispatch(subProjectScheduleError(error));
            }
        );

        return promise;
    };
};

export const resetProjectSchedule: Function = (): void => {
    return {
        type: types.PROJECT_SCHEDULE_FETCH_RESET,
    };
};

export const projectScheduleRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.PROJECT_SCHEDULE_FETCH_REQUEST,
        payload: promise,
    };
};

export const projectScheduleError: Function = (error: ErrorPayload): void => {
    return {
        type: types.PROJECT_SCHEDULE_FETCH_FAILED,
        payload: error,
    };
};

export const projectScheduleSuccess: Function = (schedule: $TSFixMe): void => {
    return {
        type: types.PROJECT_SCHEDULE_FETCH_SUCCESS,
        payload: schedule,
    };
};

// Gets list of schedules in a project.

export function fetchProjectSchedule(
    projectId: ObjectID,
    skip: PositiveNumber,
    limit: PositiveNumber
): void {
    return function (dispatch: Dispatch): void {
        let promise = null;
        promise = BackendAPI.get(
            `schedule/${projectId}/schedule?skip=${skip}&limit=${limit}`
        );
        promise.then(
            (schedule): void => {
                const data: $TSFixMe = schedule.data;
                data.projectId = projectId;
                dispatch(projectScheduleSuccess(data));
            },
            (error): void => {
                dispatch(projectScheduleError(error));
            }
        );

        return promise;
    };
}

// Create a new schedule

export const createScheduleRequest: Function = (): void => {
    return {
        type: types.CREATE_SCHEDULE_REQUEST,
    };
};

export const createScheduleError: Function = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_SCHEDULE_FAILED,
        payload: error,
    };
};

export const createScheduleSuccess: Function = (schedule: $TSFixMe): void => {
    return {
        type: types.CREATE_SCHEDULE_SUCCESS,
        payload: schedule,
    };
};

// Calls the API to create the schedule.

export const createSchedule: Function = (
    projectId: ObjectID,
    values: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `schedule/${projectId}`,
            values
        );

        dispatch(createScheduleRequest());

        promise.then(
            (schedule): void => {
                dispatch(createScheduleSuccess(schedule.data));
            },
            (error): void => {
                dispatch(createScheduleError(error));
            }
        );
        return promise;
    };
};

// Rename a Schedule

export const renameScheduleReset: Function = (): void => {
    return {
        type: types.RENAME_SCHEDULE_RESET,
    };
};

export const renameScheduleRequest: Function = (): void => {
    return {
        type: types.RENAME_SCHEDULE_REQUEST,
        payload: true,
    };
};

export const renameScheduleSuccess: Function = (schedule: $TSFixMe): void => {
    return {
        type: types.RENAME_SCHEDULE_SUCCESS,
        payload: schedule.data,
    };
};

export const renameScheduleError: Function = (error: ErrorPayload): void => {
    return {
        type: types.RENAME_SCHEDULE_FAILED,
        payload: error,
    };
};

export function renameSchedule(
    projectId: ObjectID,
    scheduleId: $TSFixMe,
    scheduleName: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `schedule/${projectId}/${scheduleId}`,
            {
                name: scheduleName,
            }
        );

        dispatch(renameScheduleRequest());

        promise
            .then(
                (schedule): void => {
                    dispatch(renameScheduleSuccess(schedule));
                },
                (error): void => {
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
                    dispatch(renameScheduleError(error));
                }
            )
            .then((): void => {
                dispatch(renameScheduleReset());
            });

        return promise;
    };
}

// Delete a Schedule

export const deleteScheduleReset: Function = (): void => {
    return {
        type: types.DELETE_SCHEDULE_RESET,
    };
};

export const deleteScheduleRequest: Function = (): void => {
    return {
        type: types.DELETE_SCHEDULE_REQUEST,
        payload: true,
    };
};

export const deleteScheduleSuccess: Function = (schedule: $TSFixMe): void => {
    return {
        type: types.DELETE_SCHEDULE_SUCCESS,
        payload: schedule.data,
    };
};

export const deleteProjectSchedules: Function = (projectId: ObjectID): void => {
    return {
        type: types.DELETE_PROJECT_SCHEDULES,
        payload: projectId,
    };
};

export const deleteScheduleError: Function = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_SCHEDULE_FAILED,
        payload: error,
    };
};

export const deleteSchedule: Function = (
    projectId: ObjectID,
    scheduleId: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = delete `schedule/${projectId}/${scheduleId}`;

        dispatch(deleteScheduleRequest());

        promise
            .then(
                (schedule): void => {
                    const data: $TSFixMe = Object.assign(
                        {},
                        { scheduleId },

                        schedule.data
                    );

                    dispatch(fetchSchedules(projectId));
                    return dispatch(deleteScheduleSuccess({ data }));
                },
                (error): void => {
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
                    dispatch(deleteScheduleError(error));
                }
            )
            .then((): void => {
                dispatch(deleteScheduleReset());
            });

        return promise;
    };
};

// Add Monitors to Schedule

export const addMonitorReset: Function = (): void => {
    return {
        type: types.ADD_MONITOR_RESET,
    };
};

export const addMonitorRequest: Function = (): void => {
    return {
        type: types.ADD_MONITOR_REQUEST,
        payload: true,
    };
};

export const addMonitorSuccess: Function = (schedule: $TSFixMe): void => {
    return {
        type: types.ADD_MONITOR_SUCCESS,
        payload: schedule.data,
    };
};

export const addMonitorError: Function = (error: ErrorPayload): void => {
    return {
        type: types.ADD_MONITOR_FAILED,
        payload: error,
    };
};

export function addMonitors(
    projectId: ObjectID,
    scheduleId: $TSFixMe,
    data: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `schedule/${projectId}/${scheduleId}`,
            data
        );

        dispatch(addMonitorRequest());

        promise
            .then(
                (schedule): void => {
                    dispatch(addMonitorSuccess(schedule));
                },
                (error): void => {
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
                    dispatch(addMonitorError(error));
                }
            )
            .then((): void => {
                dispatch(addMonitorReset());
            });

        return promise;
    };
}

// Add Users to Schedule

export const addUserReset: Function = (): void => {
    return {
        type: types.ADD_USER_RESET,
    };
};

export const addUserRequest: Function = (): void => {
    return {
        type: types.ADD_USER_REQUEST,
        payload: true,
    };
};

export const addUserSuccess: Function = (schedule: $TSFixMe): void => {
    return {
        type: types.ADD_USER_SUCCESS,
        payload: schedule.data,
    };
};

export const addUserError: Function = (error: ErrorPayload): void => {
    return {
        type: types.ADD_USER_FAILED,
        payload: error,
    };
};

export function addUsers(
    projectId: ObjectID,
    scheduleId: $TSFixMe,
    data: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `schedule/${projectId}/${scheduleId}/addUsers`,
            data
        );

        dispatch(addUserRequest());

        promise
            .then(
                (schedule): void => {
                    dispatch(addUserSuccess(schedule));
                },
                (error): void => {
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
                    dispatch(addUserError(error));
                }
            )
            .then((): void => {
                dispatch(addUserReset());
            });

        return promise;
    };
}

// onCallAlertBox

export const escalationReset: Function = (): void => {
    return {
        type: types.ESCALATION_RESET,
    };
};

export const escalationRequest: Function = (): void => {
    return {
        type: types.ESCALATION_REQUEST,
        payload: true,
    };
};

export const escalationSuccess: Function = (escalation: $TSFixMe): void => {
    return {
        type: types.ESCALATION_SUCCESS,
        payload: escalation,
    };
};

export const escalationError: Function = (error: ErrorPayload): void => {
    return {
        type: types.ESCALATION_FAILED,
        payload: error,
    };
};

export function addEscalation(
    projectId: ObjectID,
    scheduleId: $TSFixMe,
    data: $TSFixMe
): void {
    data = data.OnCallAlertBox;

    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `schedule/${projectId}/${scheduleId}/addescalation`,
            data
        );

        dispatch(escalationRequest());

        promise.then(
            (escalation): void => {
                dispatch(escalationSuccess(escalation));
            },
            (error): void => {
                dispatch(escalationError(error));
            }
        );

        return promise;
    };
}

export const getEscalation: Function = (
    projectId: ObjectID,
    scheduleId: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `schedule/${projectId}/${scheduleId}/getescalation`
        );

        dispatch(escalationRequest());

        promise.then(
            (escalation): void => {
                dispatch(escalationSuccess(escalation.data));
            },
            (error): void => {
                dispatch(escalationError(error));
            }
        );

        return promise;
    };
};

// Implements pagination for Team Members table

export const paginateNext: Function = (): void => {
    return {
        type: types.PAGINATE_NEXT,
    };
};

export const paginatePrev: Function = (): void => {
    return {
        type: types.PAGINATE_PREV,
    };
};

export const paginateReset: Function = (): void => {
    return {
        type: types.PAGINATE_RESET,
    };
};

export const paginate: Function = (type: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        type === 'next' && dispatch(paginateNext());
        type === 'prev' && dispatch(paginatePrev());
        type === 'reset' && dispatch(paginateReset());
    };
};

export const userScheduleReset: Function = (): void => {
    return {
        type: types.USER_SCHEDULE_RESET,
    };
};

export const userScheduleRequest: Function = (): void => {
    return {
        type: types.USER_SCHEDULE_REQUEST,
    };
};

export const userScheduleSuccess: Function = (userSchedule: $TSFixMe): void => {
    return {
        type: types.USER_SCHEDULE_SUCCESS,
        payload: userSchedule,
    };
};

export const userScheduleError: Function = (error: ErrorPayload): void => {
    return {
        type: types.USER_SCHEDULE_FAILED,
        payload: error,
    };
};

export const fetchUserSchedule: Function = (
    projectId: ObjectID,
    userId: ObjectID
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `schedule/${projectId}/${userId}/getescalations`
        );

        dispatch(userScheduleRequest());

        promise.then(
            (schedule): void => {
                dispatch(userScheduleSuccess(schedule.data));
            },
            (error): void => {
                dispatch(userScheduleError(error));
            }
        );

        return promise;
    };
};
