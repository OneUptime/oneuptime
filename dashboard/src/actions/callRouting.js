import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/callRouting';
import errors from '../errors';

export function getCallRoutingNumbers(projectId) {
    return function(dispatch) {
        const promise = getApi(`callRouting/${projectId}`);
        dispatch(getCallRoutingNumbersRequest());

        promise.then(
            function(numbers) {
                dispatch(getCallRoutingNumbersSuccess(numbers.data));
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
                dispatch(getCallRoutingNumbersFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function getCallRoutingNumbersSuccess(numbers) {
    return {
        type: types.GET_CALL_ROUTING_NUMBERS_SUCCESS,
        payload: numbers,
    };
}

export function getCallRoutingNumbersRequest() {
    return {
        type: types.GET_CALL_ROUTING_NUMBERS_REQUEST,
    };
}

export function getCallRoutingNumbersFailure(error) {
    return {
        type: types.GET_CALL_ROUTING_NUMBERS_FAILURE,
        payload: error,
    };
}

export function getTeamAndSchedules(projectId) {
    return function(dispatch) {
        const schedules = getApi(`schedule/${projectId}?skip=${0}&limit=${0}`);
        const teams = getApi(`team/${projectId}`);
        const promise = Promise.all([schedules, teams]);
        dispatch(getTeamAndSchedulesRequest());

        promise.then(
            function([schedule, team]) {
                const data = {
                    teams: team.data,
                    schedules: schedule.data.data,
                };
                dispatch(getTeamAndSchedulesSuccess(data));
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
                dispatch(getTeamAndSchedulesFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function getTeamAndSchedulesSuccess(data) {
    return {
        type: types.GET_TEAM_MEMBERS_AND_SCHEDULES_SUCCESS,
        payload: data,
    };
}

export function getTeamAndSchedulesRequest() {
    return {
        type: types.GET_TEAM_MEMBERS_AND_SCHEDULES_REQUEST,
    };
}

export function getTeamAndSchedulesFailure(error) {
    return {
        type: types.GET_TEAM_MEMBERS_AND_SCHEDULES_FAILURE,
        payload: error,
    };
}

export function addCallRoutingNumber(projectId, values) {
    return function(dispatch) {
        const promise = postApi(
            `callRouting/${projectId}/routingNumber`,
            values
        );
        dispatch(addCallRoutingNumberRequest());

        promise.then(
            function(number) {
                dispatch(addCallRoutingNumberSuccess(number.data));
            },
            function(error) {
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
                dispatch(addCallRoutingNumberFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function addCallRoutingNumberSuccess(number) {
    return {
        type: types.ADD_CALL_ROUTING_NUMBER_SUCCESS,
        payload: number,
    };
}

export function addCallRoutingNumberRequest() {
    return {
        type: types.ADD_CALL_ROUTING_NUMBER_REQUEST,
    };
}

export function addCallRoutingNumberFailure(error) {
    return {
        type: types.ADD_CALL_ROUTING_NUMBER_FAILURE,
        payload: error,
    };
}

export function resetAddCallRoutingNumber() {
    return {
        type: types.ADD_CALL_ROUTING_NUMBER_RESET,
    };
}

export function uploadCallRoutingAudio(
    projectId,
    callRoutingId,
    values,
    audioFieldName
) {
    return function(dispatch) {
        const promise = putApi(
            `callRouting/${projectId}/${callRoutingId}/${audioFieldName}`,
            values
        );
        dispatch(uploadCallRoutingAudioRequest(callRoutingId, audioFieldName));

        promise.then(
            function(data) {
                dispatch(
                    uploadCallRoutingAudioSuccess(
                        callRoutingId,
                        audioFieldName,
                        data.data
                    )
                );
            },
            function(error) {
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
                        errors(error),
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
    callRoutingId,
    audioFieldName,
    data
) {
    return {
        type: types.UPLOAD_CALL_ROUTING_AUDIO_SUCCESS,
        payload: { callRoutingId, audioFieldName, data },
    };
}

export function uploadCallRoutingAudioRequest(callRoutingId, audioFieldName) {
    return {
        type: types.UPLOAD_CALL_ROUTING_AUDIO_REQUEST,
        payload: { callRoutingId, audioFieldName },
    };
}

export function uploadCallRoutingAudioFailure(
    error,
    callRoutingId,
    audioFieldName
) {
    return {
        type: types.UPLOAD_CALL_ROUTING_AUDIO_FAILURE,
        payload: { callRoutingId, audioFieldName, error },
    };
}

export function addCallRoutingSchedule(projectId, callRoutingId, values) {
    return function(dispatch) {
        const promise = putApi(
            `callRouting/${projectId}/${callRoutingId}`,
            values
        );
        dispatch(addCallRoutingScheduleRequest());

        promise.then(
            function(data) {
                dispatch(addCallRoutingScheduleSuccess(data.data));
            },
            function(error) {
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
                dispatch(addCallRoutingScheduleFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function addCallRoutingScheduleSuccess(data) {
    return {
        type: types.ADD_CALL_ROUTING_SCHEDULE_SUCCESS,
        payload: data,
    };
}

export function addCallRoutingScheduleRequest() {
    return {
        type: types.ADD_CALL_ROUTING_SCHEDULE_REQUEST,
    };
}

export function addCallRoutingScheduleFailure(error) {
    return {
        type: types.ADD_CALL_ROUTING_SCHEDULE_FAILURE,
        payload: error,
    };
}

export function fetchNumbers(projectId, countryCode, numberType) {
    return function(dispatch) {
        const promise = getApi(
            `callRouting/${projectId}/routingNumbers?countryCode=${countryCode}&numberType=${numberType}`
        );
        dispatch(fetchNumbersRequest());

        promise.then(
            function(numbers) {
                dispatch(fetchNumbersSuccess(numbers.data));
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
                dispatch(fetchNumbersFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function fetchNumbersSuccess(numbers) {
    return {
        type: types.FETCH_NUMBERS_SUCCESS,
        payload: numbers,
    };
}

export function fetchNumbersRequest() {
    return {
        type: types.FETCH_NUMBERS_REQUEST,
    };
}

export function fetchNumbersFailure(error) {
    return {
        type: types.FETCH_NUMBERS_FAILURE,
        payload: error,
    };
}

export function resetFetchNumbers() {
    return {
        type: types.FETCH_NUMBERS_RESET,
    };
}

export function removeNumbers(projectId, callRoutingId) {
    return function(dispatch) {
        const promise = deleteApi(`callRouting/${projectId}/${callRoutingId}`, {
            callRoutingId,
        });
        dispatch(removeNumbersRequest(callRoutingId));

        promise.then(
            function(numbers) {
                dispatch(removeNumbersSuccess(numbers.data));
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
                dispatch(removeNumbersFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function removeNumbersSuccess(numbers) {
    return {
        type: types.REMOVE_NUMBERS_SUCCESS,
        payload: numbers,
    };
}

export function removeNumbersRequest(callRoutingId) {
    return {
        type: types.REMOVE_NUMBERS_REQUEST,
        payload: callRoutingId,
    };
}

export function removeNumbersFailure(error) {
    return {
        type: types.REMOVE_NUMBERS_FAILURE,
        payload: error,
    };
}

export function getCallRoutingLogs(projectId, skip, limit) {
    return function(dispatch) {
        const promise = getApi(
            `callRouting/${projectId}/logs?skip=${skip}&limit=${limit}`
        );
        dispatch(getCallRoutingLogsRequest());

        promise.then(
            function(logs) {
                dispatch(
                    getCallRoutingLogsSuccess({
                        logs: logs.data,
                        count: logs.data.length,
                        skip,
                        limit,
                    })
                );
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
                dispatch(getCallRoutingLogsFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function getCallRoutingLogsSuccess(logs) {
    return {
        type: types.GET_CALL_ROUTING_LOGS_SUCCESS,
        payload: logs,
    };
}

export function getCallRoutingLogsRequest() {
    return {
        type: types.GET_CALL_ROUTING_LOGS_REQUEST,
    };
}

export function getCallRoutingLogsFailure(error) {
    return {
        type: types.GET_CALL_ROUTING_LOGS_FAILURE,
        payload: error,
    };
}

export function getCallRoutingLogsReset() {
    return {
        type: types.GET_CALL_ROUTING_LOGS_RESET,
    };
}

export function removeIntroAudio(projectId, callRoutingId, backup) {
    return function(dispatch) {
        const promise = deleteApi(
            `callRouting/${projectId}/${callRoutingId}/removeAudio`,
            {
                callRoutingId,
                backup,
            }
        );
        dispatch(removeIntroAudioRequest(callRoutingId, backup));

        promise.then(
            function(numbers) {
                dispatch(removeIntroAudioSuccess(numbers.data, backup));
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
                dispatch(removeIntroAudioFailure(errors(error), backup));
            }
        );

        return promise;
    };
}

export function removeIntroAudioSuccess(numbers, backup) {
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
}

export function removeIntroAudioRequest(callRoutingId, backup) {
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

export function removeIntroAudioFailure(error, backup) {
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
}
