import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/callRouting';
import ErrorPayload from 'CommonUI/src/payload-types/error';
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
        const promise = BackendAPI.get(
            `callRouting/${projectId}?skip=${skip}&limit=${limit}`
        );
        dispatch(getCallRoutingNumbersRequest());

        promise.then(
            (numbers): void => {
                dispatch(getCallRoutingNumbersSuccess(numbers.data));
            },
            (error): void => {
                dispatch(getCallRoutingNumbersFailure(error));
            }
        );

        return promise;
    };
}

export const getCallRoutingNumbersSuccess = (numbers: $TSFixMe): void => {
    return {
        type: types.GET_CALL_ROUTING_NUMBERS_SUCCESS,
        payload: numbers,
    };
};

export const getCallRoutingNumbersRequest = (): void => {
    return {
        type: types.GET_CALL_ROUTING_NUMBERS_REQUEST,
    };
};

export const getCallRoutingNumbersFailure = (error: ErrorPayload): void => {
    return {
        type: types.GET_CALL_ROUTING_NUMBERS_FAILURE,
        payload: error,
    };
};

export const getTeamAndSchedules = (projectId: ObjectID): void => {
    return function (dispatch: Dispatch): void {
        const schedules = BackendAPI.get(
            `schedule/${projectId}?skip=${0}&limit=${0}`
        );
        const teams = BackendAPI.get(`team/${projectId}`);
        const promise = Promise.all([schedules, teams]);
        dispatch(getTeamAndSchedulesRequest());

        promise.then(
            ([schedule, team]): void => {
                const data = {
                    teams: team.data,

                    schedules: schedule.data.data,
                };
                dispatch(getTeamAndSchedulesSuccess(data));
            },
            (error): void => {
                dispatch(getTeamAndSchedulesFailure(error));
            }
        );

        return promise;
    };
};

export const getTeamAndSchedulesSuccess = (data: $TSFixMe): void => {
    return {
        type: types.GET_TEAM_MEMBERS_AND_SCHEDULES_SUCCESS,
        payload: data,
    };
};

export const getTeamAndSchedulesRequest = (): void => {
    return {
        type: types.GET_TEAM_MEMBERS_AND_SCHEDULES_REQUEST,
    };
};

export const getTeamAndSchedulesFailure = (error: ErrorPayload): void => {
    return {
        type: types.GET_TEAM_MEMBERS_AND_SCHEDULES_FAILURE,
        payload: error,
    };
};

export const addCallRoutingNumber = (
    projectId: ObjectID,
    values: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
            `callRouting/${projectId}/routingNumber`,
            values
        );
        dispatch(addCallRoutingNumberRequest());

        promise.then(
            (number): void => {
                dispatch(addCallRoutingNumberSuccess(number.data));
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
                dispatch(addCallRoutingNumberFailure(error));
            }
        );

        return promise;
    };
};

export const addCallRoutingNumberSuccess = (number: $TSFixMe): void => {
    return {
        type: types.ADD_CALL_ROUTING_NUMBER_SUCCESS,
        payload: number,
    };
};

export const addCallRoutingNumberRequest = (): void => {
    return {
        type: types.ADD_CALL_ROUTING_NUMBER_REQUEST,
    };
};

export const addCallRoutingNumberFailure = (error: ErrorPayload): void => {
    return {
        type: types.ADD_CALL_ROUTING_NUMBER_FAILURE,
        payload: error,
    };
};

export const resetAddCallRoutingNumber = (): void => {
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
        const promise = BackendAPI.put(
            `callRouting/${projectId}/${callRoutingId}/${audioFieldName}`,
            values
        );
        dispatch(uploadCallRoutingAudioRequest(callRoutingId, audioFieldName));

        promise.then(
            (data): void => {
                dispatch(
                    uploadCallRoutingAudioSuccess(
                        callRoutingId,
                        audioFieldName,

                        data.data
                    )
                );
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
        const promise = BackendAPI.put(
            `callRouting/${projectId}/${callRoutingId}`,
            values
        );
        dispatch(addCallRoutingScheduleRequest());

        promise.then(
            (data): void => {
                dispatch(addCallRoutingScheduleSuccess(data.data));
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
                dispatch(addCallRoutingScheduleFailure(error));
            }
        );

        return promise;
    };
}

export const addCallRoutingScheduleSuccess = (data: $TSFixMe): void => {
    return {
        type: types.ADD_CALL_ROUTING_SCHEDULE_SUCCESS,
        payload: data,
    };
};

export const addCallRoutingScheduleRequest = (): void => {
    return {
        type: types.ADD_CALL_ROUTING_SCHEDULE_REQUEST,
    };
};

export const addCallRoutingScheduleFailure = (error: ErrorPayload): void => {
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
        const promise = BackendAPI.get(
            `callRouting/${projectId}/routingNumbers?countryCode=${countryCode}&numberType=${numberType}`
        );
        dispatch(fetchNumbersRequest());

        promise.then(
            (numbers): void => {
                dispatch(fetchNumbersSuccess(numbers.data));
            },
            (error): void => {
                dispatch(fetchNumbersFailure(error));
            }
        );

        return promise;
    };
}

export const fetchNumbersSuccess = (numbers: $TSFixMe): void => {
    return {
        type: types.FETCH_NUMBERS_SUCCESS,
        payload: numbers,
    };
};

export const fetchNumbersRequest = (): void => {
    return {
        type: types.FETCH_NUMBERS_REQUEST,
    };
};

export const fetchNumbersFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_NUMBERS_FAILURE,
        payload: error,
    };
};

export const resetFetchNumbers = (): void => {
    return {
        type: types.FETCH_NUMBERS_RESET,
    };
};

export const removeNumbers = (
    projectId: ObjectID,
    callRoutingId: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = delete (`callRouting/${projectId}/${callRoutingId}`,
        {
            callRoutingId,
        });
        dispatch(removeNumbersRequest(callRoutingId));

        promise.then(
            (numbers): void => {
                dispatch(removeNumbersSuccess(numbers.data));
            },
            (error): void => {
                dispatch(removeNumbersFailure(error));
            }
        );

        return promise;
    };
};

export const removeNumbersSuccess = (numbers: $TSFixMe): void => {
    return {
        type: types.REMOVE_NUMBERS_SUCCESS,
        payload: numbers,
    };
};

export const removeNumbersRequest = (callRoutingId: $TSFixMe): void => {
    return {
        type: types.REMOVE_NUMBERS_REQUEST,
        payload: callRoutingId,
    };
};

export const removeNumbersFailure = (error: ErrorPayload): void => {
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
        const promise = BackendAPI.get(
            `callRouting/${projectId}/logs?skip=${skip}&limit=${limit}`
        );
        dispatch(getCallRoutingLogsRequest());

        promise.then(
            (logs): void => {
                dispatch(
                    getCallRoutingLogsSuccess({
                        logs: logs.data,

                        count: logs.data.length,
                        skip,
                        limit,
                    })
                );
            },
            (error): void => {
                dispatch(getCallRoutingLogsFailure(error));
            }
        );

        return promise;
    };
}

export const getCallRoutingLogsSuccess = (logs: $TSFixMe): void => {
    return {
        type: types.GET_CALL_ROUTING_LOGS_SUCCESS,
        payload: logs,
    };
};

export const getCallRoutingLogsRequest = (): void => {
    return {
        type: types.GET_CALL_ROUTING_LOGS_REQUEST,
    };
};

export const getCallRoutingLogsFailure = (error: ErrorPayload): void => {
    return {
        type: types.GET_CALL_ROUTING_LOGS_FAILURE,
        payload: error,
    };
};

export const getCallRoutingLogsReset = (): void => {
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
        const promise =
            delete (`callRouting/${projectId}/${callRoutingId}/removeAudio`,
            {
                callRoutingId,
                backup,
            });
        dispatch(removeIntroAudioRequest(callRoutingId, backup));

        promise.then(
            (numbers): void => {
                dispatch(removeIntroAudioSuccess(numbers.data, backup));
            },
            (error): void => {
                dispatch(removeIntroAudioFailure(error, backup));
            }
        );

        return promise;
    };
}

export const removeIntroAudioSuccess = (
    numbers: $TSFixMe,
    backup: $TSFixMe
): void => {
    if (backup) {
        return {
            type: types.REMOVE_BACKUP_INTRO_AUDIO_SUCCESS,
            payload: numbers,
        };
    } else {
        return {
            type: types.REMOVE_INTRO_AUDIO_SUCCESS,
            payload: numbers,
        };
    }
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
    } else {
        return {
            type: types.REMOVE_INTRO_AUDIO_REQUEST,
            payload: callRoutingId,
        };
    }
}

export const removeIntroAudioFailure = (
    error: ErrorPayload,
    backup: $TSFixMe
): void => {
    if (backup) {
        return {
            type: types.REMOVE_BACKUP_INTRO_AUDIO_FAILURE,
            payload: error,
        };
    } else {
        return {
            type: types.REMOVE_INTRO_AUDIO_FAILURE,
            payload: error,
        };
    }
};
