import BackendAPI from '../api';
import { Dispatch } from 'redux';
import * as types from '../constants/tutorial';
import Route from 'common/types/api/route';

export const fetchTutorialRequest = (promise: $TSFixMe) => {
    return {
        type: types.FETCH_TUTORIAL_REQUEST,
        payload: promise,
    };
};

export const fetchTutorialSuccess = (tutorial: $TSFixMe) => {
    return {
        type: types.FETCH_TUTORIAL_SUCCESS,
        payload: tutorial,
    };
};

export const fetchTutorialError = (error: $TSFixMe) => {
    return {
        type: types.FETCH_TUTORIAL_FAILURE,
        payload: error,
    };
};

export const resetFetchTutorial = () => {
    return {
        type: types.FETCH_TUTORIAL_RESET,
    };
};

export const closeTutorialRequest = (promise: $TSFixMe) => {
    return {
        type: types.CLOSE_TUTORIAL_REQUEST,
        payload: promise,
    };
};

export const closeTutorialSuccess = (tutorial: $TSFixMe) => {
    return {
        type: types.CLOSE_TUTORIAL_SUCCESS,
        payload: tutorial,
    };
};

export const closeTutorialError = (error: $TSFixMe) => {
    return {
        type: types.CLOSE_TUTORIAL_FAILURE,
        payload: error,
    };
};

export const resetCloseTutorial = () => {
    return {
        type: types.CLOSE_TUTORIAL_RESET,
    };
};

export const fetchTutorial = () => {
    return function (dispatch: Dispatch) {
        let promise = null;
        promise = BackendAPI.get(new Route('tutorial'));

        dispatch(fetchTutorialRequest(promise));

        promise.then(
            function (tutorial) {
                dispatch(fetchTutorialSuccess(tutorial.data));
            },
            function (error) {
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
};

export const closeTutorial = (type: $TSFixMe, projectId: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        let promise = null;
        promise = BackendAPI.put('tutorial', { type, projectId });

        dispatch(closeTutorialRequest(promise));

        promise.then(
            function (tutorial) {
                dispatch(closeTutorialSuccess(tutorial.data));
            },
            function (error) {
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
};
