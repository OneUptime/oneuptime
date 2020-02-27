import { getApi, putApi } from '../api';
import * as types from '../constants/tutorial';

export function fetchTutorialRequest(promise) {
    return {
        type: types.FETCH_TUTORIAL_REQUEST,
        payload: promise,
    };
}

export function fetchTutorialSuccess(tutorial) {
    return {
        type: types.FETCH_TUTORIAL_SUCCESS,
        payload: tutorial,
    };
}

export function fetchTutorialError(error) {
    return {
        type: types.FETCH_TUTORIAL_FAILURE,
        payload: error,
    };
}

export function resetFetchTutorial() {
    return {
        type: types.FETCH_TUTORIAL_RESET,
    };
}

export function closeTutorialRequest(promise) {
    return {
        type: types.CLOSE_TUTORIAL_REQUEST,
        payload: promise,
    };
}

export function closeTutorialSuccess(tutorial) {
    return {
        type: types.CLOSE_TUTORIAL_SUCCESS,
        payload: tutorial,
    };
}

export function closeTutorialError(error) {
    return {
        type: types.CLOSE_TUTORIAL_FAILURE,
        payload: error,
    };
}

export function resetCloseTutorial() {
    return {
        type: types.CLOSE_TUTORIAL_RESET,
    };
}

export function fetchTutorial() {
    return function(dispatch) {
        let promise = null;
        promise = getApi('tutorial');

        dispatch(fetchTutorialRequest(promise));

        promise.then(
            function(tutorial) {
                dispatch(fetchTutorialSuccess(tutorial.data));
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
                dispatch(fetchTutorialError(error));
            }
        );

        return promise;
    };
}

export function closeTutorial(type) {
    return function(dispatch) {
        let promise = null;
        promise = putApi('tutorial', { type });

        dispatch(closeTutorialRequest(promise));

        promise.then(
            function(tutorial) {
                dispatch(closeTutorialSuccess(tutorial.data));
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
                dispatch(closeTutorialError(error));
            }
        );

        return promise;
    };
}
