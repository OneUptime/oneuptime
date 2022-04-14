import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/tutorial';
import Route from 'Common/Types/api/route';
import ErrorPayload from 'CommonUI/src/payload-types/error';
export const fetchTutorialRequest = (promise: $TSFixMe): void => {
    return {
        type: types.FETCH_TUTORIAL_REQUEST,
        payload: promise,
    };
};

export const fetchTutorialSuccess = (tutorial: $TSFixMe): void => {
    return {
        type: types.FETCH_TUTORIAL_SUCCESS,
        payload: tutorial,
    };
};

export const fetchTutorialError = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_TUTORIAL_FAILURE,
        payload: error,
    };
};

export const resetFetchTutorial = (): void => {
    return {
        type: types.FETCH_TUTORIAL_RESET,
    };
};

export const closeTutorialRequest = (promise: $TSFixMe): void => {
    return {
        type: types.CLOSE_TUTORIAL_REQUEST,
        payload: promise,
    };
};

export const closeTutorialSuccess = (tutorial: $TSFixMe): void => {
    return {
        type: types.CLOSE_TUTORIAL_SUCCESS,
        payload: tutorial,
    };
};

export const closeTutorialError = (error: ErrorPayload): void => {
    return {
        type: types.CLOSE_TUTORIAL_FAILURE,
        payload: error,
    };
};

export const resetCloseTutorial = (): void => {
    return {
        type: types.CLOSE_TUTORIAL_RESET,
    };
};

export const fetchTutorial = (): void => {
    return function (dispatch: Dispatch): void {
        let promise = null;
        promise = BackendAPI.get(new Route('tutorial'));

        dispatch(fetchTutorialRequest(promise));

        promise.then(
            (tutorial): void => {
                dispatch(fetchTutorialSuccess(tutorial.data));
            },
            (error): void => {
                dispatch(fetchTutorialError(error));
            }
        );

        return promise;
    };
};

export const closeTutorial = (type: $TSFixMe, projectId: ObjectID): void => {
    return function (dispatch: Dispatch): void {
        let promise = null;
        promise = BackendAPI.put('tutorial', { type, projectId });

        dispatch(closeTutorialRequest(promise));

        promise.then(
            (tutorial): void => {
                dispatch(closeTutorialSuccess(tutorial.data));
            },
            (error): void => {
                dispatch(closeTutorialError(error));
            }
        );

        return promise;
    };
};
