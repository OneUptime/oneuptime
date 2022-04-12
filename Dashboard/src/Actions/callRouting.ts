import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/callRouting';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
export function getCallRoutingNumbers(
    projectId: string,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    if (!skip) skip = 0;
    if (!limit) limit = 10;
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `callRouting/${projectId}?skip=${skip}&limit=${limit}`
        );
        dispatch(getCallRoutingNumbersRequest());

        promise.then(
            function (numbers) {
                dispatch(getCallRoutingNumbersSuccess(numbers.data));
            },
            function (error) {
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

export const getTeamAndSchedules = (projectId: string): void => {
    return function (dispatch: Dispatch) {
        const schedules = BackendAPI.get(
            `schedule/${projectId}?skip=${0}&limit=${0}`
        );
        const teams = BackendAPI.get(`team/${projectId}`);
        const promise = Promise.all([schedules, teams]);
        dispatch(getTeamAndSchedulesRequest());

        promise.then(
            function ([schedule, team]) {
                const data = {
                    teams: team.data,

                    schedules: schedule.data.data,
                };
                dispatch(getTeamAndSchedulesSuccess(data));
            },
            function (error) {
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

export const addCallRoutingNumber = (projectId: string, values: $TSFixMe): void => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(
            `callRouting/${projectId}/routingNumber`,
            values
        );
        dispatch(addCallRoutingNumberRequest());

        promise.then(
            function (number) {
                dispatch(addCallRoutingNumberSuccess(number.data));
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
    projectId: string,
    callRoutingId: $TSFixMe,
    values: $TSFixMe,
    audioFieldName: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(
            `callRouting/${projectId}/${callRoutingId}/${audioFieldName}`,
            values
        );
        dispatch(uploadCallRoutingAudioRequest(callRoutingId, audioFieldName));

        promise.then(
            function (data) {
                dispatch(
                    uploadCallRoutingAudioSuccess(
                        callRoutingId,
                        audioFieldName,

                        data.data
                    )
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
) {
    return {
        type: types.UPLOAD_CALL_ROUTING_AUDIO_SUCCESS,
        payload: { callRoutingId, audioFieldName, data },
    };
}

export function uploadCallRoutingAudioRequest(
    callRoutingId: $TSFixMe,
    audioFieldName: $TSFixMe
) {
    return {
        type: types.UPLOAD_CALL_ROUTING_AUDIO_REQUEST,
        payload: { callRoutingId, audioFieldName },
    };
}

export function uploadCallRoutingAudioFailure(
    error: ErrorPayload,
    callRoutingId: $TSFixMe,
    audioFieldName: $TSFixMe
) {
    return {
        type: types.UPLOAD_CALL_ROUTING_AUDIO_FAILURE,
        payload: { callRoutingId, audioFieldName, error },
    };
}

export function addCallRoutingSchedule(
    projectId: string,
    callRoutingId: $TSFixMe,
    values: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(
            `callRouting/${projectId}/${callRoutingId}`,
            values
        );
        dispatch(addCallRoutingScheduleRequest());

        promise.then(
            function (data) {
                dispatch(addCallRoutingScheduleSuccess(data.data));
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
    projectId: string,
    countryCode: $TSFixMe,
    numberType: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `callRouting/${projectId}/routingNumbers?countryCode=${countryCode}&numberType=${numberType}`
        );
        dispatch(fetchNumbersRequest());

        promise.then(
            function (numbers) {
                dispatch(fetchNumbersSuccess(numbers.data));
            },
            function (error) {
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

export const removeNumbers = (projectId: string, callRoutingId: $TSFixMe): void => {
    return function (dispatch: Dispatch) {
        const promise = delete (`callRouting/${projectId}/${callRoutingId}`,
        {
            callRoutingId,
        });
        dispatch(removeNumbersRequest(callRoutingId));

        promise.then(
            function (numbers) {
                dispatch(removeNumbersSuccess(numbers.data));
            },
            function (error) {
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
    projectId: string,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `callRouting/${projectId}/logs?skip=${skip}&limit=${limit}`
        );
        dispatch(getCallRoutingLogsRequest());

        promise.then(
            function (logs) {
                dispatch(
                    getCallRoutingLogsSuccess({
                        logs: logs.data,

                        count: logs.data.length,
                        skip,
                        limit,
                    })
                );
            },
            function (error) {
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
    projectId: string,
    callRoutingId: $TSFixMe,
    backup: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise =
            delete (`callRouting/${projectId}/${callRoutingId}/removeAudio`,
            {
                callRoutingId,
                backup,
            });
        dispatch(removeIntroAudioRequest(callRoutingId, backup));

        promise.then(
            function (numbers) {
                dispatch(removeIntroAudioSuccess(numbers.data, backup));
            },
            function (error) {
                dispatch(removeIntroAudioFailure(error, backup));
            }
        );

        return promise;
    };
}

export const removeIntroAudioSuccess = (
    numbers: $TSFixMe,
    backup: $TSFixMe
) => {
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
) {
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
) => {
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
