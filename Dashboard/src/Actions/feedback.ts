import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/feedback';
import ErrorPayload from 'CommonUI/src/payload-types/error';
export const openFeedbackModal = function () {
    return {
        type: types.OPEN_FEEDBACK_MODAL,
    };
};
export const closeFeedbackModal = function () {
    return {
        type: types.CLOSE_FEEDBACK_MODAL,
    };
};

// Create a new project

export const createFeedbackRequest = (): void => {
    return {
        type: types.CREATE_FEEDBACK_REQUEST,
    };
};

export const createFeedbackError = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_FEEDBACK_FAILED,
        payload: error,
    };
};

export const createFeedbackSuccess = (project: $TSFixMe): void => {
    return {
        type: types.CREATE_FEEDBACK_SUCCESS,
        payload: project,
    };
};

export const resetCreateFeedback = (): void => {
    return {
        type: types.CREATE_FEEDBACK_RESET,
    };
};

// Calls the API to register a user.
export function createFeedback(
    projectId: string,
    feedback: $TSFixMe,
    page: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(`feedback/${projectId}`, {
            feedback,
            page,
        });

        dispatch(createFeedbackRequest());

        return promise.then(
            function (feedback) {
                dispatch(createFeedbackSuccess(feedback));
                return feedback;
            },
            function (error) {
                dispatch(createFeedbackError(error));
            }
        );
    };
}
