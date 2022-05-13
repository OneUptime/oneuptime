import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/callRouting';
import ErrorPayload from 'CommonUI/src/PayloadTypes/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
export function getCallRoutingNumbers(
    projectId: ObjectID,
    skip: PositiveNumber,
    limit: PositiveNumber
): void {
    if (!skip) {
        skip = 0;
    }
    if (!limit) {
        limit = 10;
    }
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `callRouting/${projectId}?skip=${skip}&limit=${limit}`
        );
        dispatch(getCallRoutingNumbersRequest());

        promise.then(
            (numbers: $TSFixMe): void => {
                dispatch(getCallRoutingNumbersSuccess(numbers.data));
            },
            (error: $TSFixMe): void => {
                dispatch(getCallRoutingNumbersFailure(error));
            }
        );

        return promise;
    };
}

export const getCallRoutingNumbersSuccess: Function = (
    numbers: $TSFixMe
): void => {
    return {
        type: types.GET_CALL_ROUTING_NUMBERS_SUCCESS,
        payload: numbers,
    };
};

export const getCallRoutingNumbersRequest: Function = (): void => {
    return {
        type: types.GET_CALL_ROUTING_NUMBERS_REQUEST,
    };
};

export const getCallRoutingNumbersFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.GET_CALL_ROUTING_NUMBERS_FAILURE,
        payload: error,
    };
};

export const getTeamAndSchedules: Function = (projectId: ObjectID): void => {
    return function (dispatch: Dispatch): void {
        const schedules: $TSFixMe = BackendAPI.get(
            `schedule/${projectId}?skip=${0}&limit=${0}`
        );
        const teams: $TSFixMe = BackendAPI.get(`team/${projectId}`);
        const promise: $TSFixMe = Promise.all([schedules, teams]);
        dispatch(getTeamAndSchedulesRequest());

        promise.then(
            ([schedule, team]: $TSFixMe): void => {
                const data: $TSFixMe = {
                    teams: team.data,

                    schedules: schedule.data.data,
                };
                dispatch(getTeamAndSchedulesSuccess(data));
            },
            (error: $TSFixMe): void => {
                dispatch(getTeamAndSchedulesFailure(error));
            }
        );

        return promise;
    };
};

export const getTeamAndSchedulesSuccess: Function = (data: $TSFixMe): void => {
    return {
        type: types.GET_TEAM_MEMBERS_AND_SCHEDULES_SUCCESS,
        payload: data,
    };
};

export const getTeamAndSchedulesRequest: Function = (): void => {
    return {
        type: types.GET_TEAM_MEMBERS_AND_SCHEDULES_REQUEST,
    };
};

export const getTeamAndSchedulesFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.GET_TEAM_MEMBERS_AND_SCHEDULES_FAILURE,
        payload: error,
    };
};

export const addCallRoutingNumber: Function = (
    projectId: ObjectID,
    values: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `callRouting/${projectId}/routingNumber`,
            values
        );
        dispatch(addCallRoutingNumberRequest());

        promise.then(
            (number: $TSFixMe): void => {
                dispatch(addCallRoutingNumberSuccess(number.data));
            },
            (error: $TSFixMe): void => {
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
                dispatch(addCallRoutingNumberFailure(error));
            }
        );

        return promise;
    };
};

export const addCallRoutingNumberSuccess: Function = (
    number: $TSFixMe
): void => {
    return {
        type: types.ADD_CALL_ROUTING_NUMBER_SUCCESS,
        payload: number,
    };
};

export const addCallRoutingNumberRequest: Function = (): void => {
    return {
        type: types.ADD_CALL_ROUTING_NUMBER_REQUEST,
    };
};

export const addCallRoutingNumberFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.ADD_CALL_ROUTING_NUMBER_FAILURE,
        payload: error,
    };
};

export const resetAddCallRoutingNumber: Function = (): void => {
    return {
        type: types.ADD_CALL_ROUTING_NUMBER_RESET,
    };
};

export function uploadCallRoutingAudio(
    projectId: ObjectID,
    callRoutingId: $TSFixMe,
    values: $TSFixMe,
    audioFieldName: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `callRouting/${projectId}/${callRoutingId}/${audioFieldName}`,
            values
        );
        dispatch(uploadCallRoutingAudioRequest(callRoutingId, audioFieldName));

        promise.then(
            (data: $TSFixMe): void => {
                dispatch(
                    uploadCallRoutingAudioSuccess(
                        callRoutingId,
                        audioFieldName,

                        data.data
                    )
                );
            },
            (error: $TSFixMe): void => {
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
                dispatch(
                    uploadCallRoutingAudioFailure(
                        error,
                        callRoutingId,
                        audioFieldName
                    )
                );
            }
        );

        return promise;
    };
}

export function uploadCallRoutingAudioSuccess(
    callRoutingId: $TSFixMe,
    audioFieldName: $TSFixMe,
    data: $TSFixMe
): void {
    return {
        type: types.UPLOAD_CALL_ROUTING_AUDIO_SUCCESS,
        payload: { callRoutingId, audioFieldName, data },
    };
}

export function uploadCallRoutingAudioRequest(
    callRoutingId: $TSFixMe,
    audioFieldName: $TSFixMe
): void {
    return {
        type: types.UPLOAD_CALL_ROUTING_AUDIO_REQUEST,
        payload: { callRoutingId, audioFieldName },
    };
}

export function uploadCallRoutingAudioFailure(
    error: ErrorPayload,
    callRoutingId: $TSFixMe,
    audioFieldName: $TSFixMe
): void {
    return {
        type: types.UPLOAD_CALL_ROUTING_AUDIO_FAILURE,
        payload: { callRoutingId, audioFieldName, error },
    };
}

export function addCallRoutingSchedule(
    projectId: ObjectID,
    callRoutingId: $TSFixMe,
    values: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `callRouting/${projectId}/${callRoutingId}`,
            values
        );
        dispatch(addCallRoutingScheduleRequest());

        promise.then(
            (data: $TSFixMe): void => {
                dispatch(addCallRoutingScheduleSuccess(data.data));
            },
            (error: $TSFixMe): void => {
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
                dispatch(addCallRoutingScheduleFailure(error));
            }
        );

        return promise;
    };
}

export const addCallRoutingScheduleSuccess: Function = (
    data: $TSFixMe
): void => {
    return {
        type: types.ADD_CALL_ROUTING_SCHEDULE_SUCCESS,
        payload: data,
    };
};

export const addCallRoutingScheduleRequest: Function = (): void => {
    return {
        type: types.ADD_CALL_ROUTING_SCHEDULE_REQUEST,
    };
};

export const addCallRoutingScheduleFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.ADD_CALL_ROUTING_SCHEDULE_FAILURE,
        payload: error,
    };
};

export function fetchNumbers(
    projectId: ObjectID,
    countryCode: $TSFixMe,
    numberType: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `callRouting/${projectId}/routingNumbers?countryCode=${countryCode}&numberType=${numberType}`
        );
        dispatch(fetchNumbersRequest());

        promise.then(
            (numbers: $TSFixMe): void => {
                dispatch(fetchNumbersSuccess(numbers.data));
            },
            (error: $TSFixMe): void => {
                dispatch(fetchNumbersFailure(error));
            }
        );

        return promise;
    };
}

export const fetchNumbersSuccess: Function = (numbers: $TSFixMe): void => {
    return {
        type: types.FETCH_NUMBERS_SUCCESS,
        payload: numbers,
    };
};

export const fetchNumbersRequest: Function = (): void => {
    return {
        type: types.FETCH_NUMBERS_REQUEST,
    };
};

export const fetchNumbersFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_NUMBERS_FAILURE,
        payload: error,
    };
};

export const resetFetchNumbers: Function = (): void => {
    return {
        type: types.FETCH_NUMBERS_RESET,
    };
};

export const removeNumbers: Function = (
    projectId: ObjectID,
    callRoutingId: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe =
            delete (`callRouting/${projectId}/${callRoutingId}`,
            {
                callRoutingId,
            });
        dispatch(removeNumbersRequest(callRoutingId));

        promise.then(
            (numbers: $TSFixMe): void => {
                dispatch(removeNumbersSuccess(numbers.data));
            },
            (error: $TSFixMe): void => {
                dispatch(removeNumbersFailure(error));
            }
        );

        return promise;
    };
};

export const removeNumbersSuccess: Function = (numbers: $TSFixMe): void => {
    return {
        type: types.REMOVE_NUMBERS_SUCCESS,
        payload: numbers,
    };
};

export const removeNumbersRequest: Function = (
    callRoutingId: $TSFixMe
): void => {
    return {
        type: types.REMOVE_NUMBERS_REQUEST,
        payload: callRoutingId,
    };
};

export const removeNumbersFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.REMOVE_NUMBERS_FAILURE,
        payload: error,
    };
};

export function getCallRoutingLogs(
    projectId: ObjectID,
    skip: PositiveNumber,
    limit: PositiveNumber
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `callRouting/${projectId}/logs?skip=${skip}&limit=${limit}`
        );
        dispatch(getCallRoutingLogsRequest());

        promise.then(
            (logs: $TSFixMe): void => {
                dispatch(
                    getCallRoutingLogsSuccess({
                        logs: logs.data,

                        count: logs.data.length,
                        skip,
                        limit,
                    })
                );
            },
            (error: $TSFixMe): void => {
                dispatch(getCallRoutingLogsFailure(error));
            }
        );

        return promise;
    };
}

export const getCallRoutingLogsSuccess: Function = (logs: $TSFixMe): void => {
    return {
        type: types.GET_CALL_ROUTING_LOGS_SUCCESS,
        payload: logs,
    };
};

export const getCallRoutingLogsRequest: Function = (): void => {
    return {
        type: types.GET_CALL_ROUTING_LOGS_REQUEST,
    };
};

export const getCallRoutingLogsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.GET_CALL_ROUTING_LOGS_FAILURE,
        payload: error,
    };
};

export const getCallRoutingLogsReset: Function = (): void => {
    return {
        type: types.GET_CALL_ROUTING_LOGS_RESET,
    };
};

export function removeIntroAudio(
    projectId: ObjectID,
    callRoutingId: $TSFixMe,
    backup: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe =
            delete (`callRouting/${projectId}/${callRoutingId}/removeAudio`,
            {
                callRoutingId,
                backup,
            });
        dispatch(removeIntroAudioRequest(callRoutingId, backup));

        promise.then(
            (numbers: $TSFixMe): void => {
                dispatch(removeIntroAudioSuccess(numbers.data, backup));
            },
            (error: $TSFixMe): void => {
                dispatch(removeIntroAudioFailure(error, backup));
            }
        );

        return promise;
    };
}

export const removeIntroAudioSuccess: Function = (
    numbers: $TSFixMe,
    backup: $TSFixMe
): void => {
    if (backup) {
        return {
            type: types.REMOVE_BACKUP_INTRO_AUDIO_SUCCESS,
            payload: numbers,
        };
    }
    return {
        type: types.REMOVE_INTRO_AUDIO_SUCCESS,
        payload: numbers,
    };
};

export function removeIntroAudioRequest(
    callRoutingId: $TSFixMe,
    backup: $TSFixMe
): void {
    if (backup) {
        return {
            type: types.REMOVE_BACKUP_INTRO_AUDIO_REQUEST,
            payload: callRoutingId,
        };
    }
    return {
        type: types.REMOVE_INTRO_AUDIO_REQUEST,
        payload: callRoutingId,
    };
}

export const removeIntroAudioFailure: Function = (
    error: ErrorPayload,
    backup: $TSFixMe
): void => {
    if (backup) {
        return {
            type: types.REMOVE_BACKUP_INTRO_AUDIO_FAILURE,
            payload: error,
        };
    }
    return {
        type: types.REMOVE_INTRO_AUDIO_FAILURE,
        payload: error,
    };
};
