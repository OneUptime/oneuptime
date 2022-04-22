import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/tutorial';
import Route from 'Common/Types/api/route';
import ErrorPayload from 'CommonUI/src/payload-types/error';
export const fetchTutorialRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.FETCH_TUTORIAL_REQUEST,
        payload: promise,
    };
};

export const fetchTutorialSuccess: Function = (tutorial: $TSFixMe): void => {
    return {
        type: types.FETCH_TUTORIAL_SUCCESS,
        payload: tutorial,
    };
};

export const fetchTutorialError: Function = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_TUTORIAL_FAILURE,
        payload: error,
    };
};

export const resetFetchTutorial: Function = (): void => {
    return {
        type: types.FETCH_TUTORIAL_RESET,
    };
};

export const closeTutorialRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.CLOSE_TUTORIAL_REQUEST,
        payload: promise,
    };
};

export const closeTutorialSuccess: Function = (tutorial: $TSFixMe): void => {
    return {
        type: types.CLOSE_TUTORIAL_SUCCESS,
        payload: tutorial,
    };
};

export const closeTutorialError: Function = (error: ErrorPayload): void => {
    return {
        type: types.CLOSE_TUTORIAL_FAILURE,
        payload: error,
    };
};

export const resetCloseTutorial: Function = (): void => {
    return {
        type: types.CLOSE_TUTORIAL_RESET,
    };
};

export const fetchTutorial: Function = (): void => {
    return function (dispatch: Dispatch): void {
        let promise: $TSFixMe = null;
        promise = BackendAPI.get(new Route('tutorial'));

        dispatch(fetchTutorialRequest(promise));

        promise.then(
            (tutorial: $TSFixMe): void => {
                dispatch(fetchTutorialSuccess(tutorial.data));
            },
            (error: $TSFixMe): void => {
                dispatch(fetchTutorialError(error));
            }
        );

        return promise;
    };
};

export const closeTutorial: Function = (
    type: $TSFixMe,
    projectId: ObjectID
): void => {
    return function (dispatch: Dispatch): void {
        let promise: $TSFixMe = null;
        promise = BackendAPI.put('tutorial', { type, projectId });

        dispatch(closeTutorialRequest(promise));

        promise.then(
            (tutorial: $TSFixMe): void => {
                dispatch(closeTutorialSuccess(tutorial.data));
            },
            (error: $TSFixMe): void => {
                dispatch(closeTutorialError(error));
            }
        );

        return promise;
    };
};
