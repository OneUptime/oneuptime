import { postApi, getApi, deleteApi } from '../api';
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
        const promise = getApi(`callRouting/${projectId}/getTeamAndSchedules`);
        dispatch(getTeamAndSchedulesRequest());

        promise.then(
            function(data) {
                dispatch(getTeamAndSchedulesSuccess(data.data));
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
        const promise = postApi(`callRouting/${projectId}/addNumber`, values);
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

export function addCallRoutingSchedule(projectId, callRoutingId, values) {
    return function(dispatch) {
        const promise = postApi(
            `callRouting/${projectId}/${callRoutingId}/addCallRoutingSchedule`,
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
            `callRouting/${projectId}/fetchnumbers?countryCode=${countryCode}&numberType=${numberType}`
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
