import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/feedback';
import ErrorPayload from 'CommonUI/src/payload-types/error';
export const openFeedbackModal: $TSFixMe = function (): void {
    return {
        type: types.OPEN_FEEDBACK_MODAL,
    };
};
export const closeFeedbackModal: $TSFixMe = function (): void {
    return {
        type: types.CLOSE_FEEDBACK_MODAL,
    };
};

// Create a new project

export const createFeedbackRequest: Function = (): void => {
    return {
        type: types.CREATE_FEEDBACK_REQUEST,
    };
};

export const createFeedbackError: Function = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_FEEDBACK_FAILED,
        payload: error,
    };
};

export const createFeedbackSuccess: Function = (project: $TSFixMe): void => {
    return {
        type: types.CREATE_FEEDBACK_SUCCESS,
        payload: project,
    };
};

export const resetCreateFeedback: Function = (): void => {
    return {
        type: types.CREATE_FEEDBACK_RESET,
    };
};

// Calls the API to register a user.
export function createFeedback(
    projectId: ObjectID,
    feedback: $TSFixMe,
    page: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(`feedback/${projectId}`, {
            feedback,
            page,
        });

        dispatch(createFeedbackRequest());

        return promise.then(
            (feedback: $TSFixMe): void => {
                dispatch(createFeedbackSuccess(feedback));
                return feedback;
            },
            (error: $TSFixMe): void => {
                dispatch(createFeedbackError(error));
            }
        );
    };
}
