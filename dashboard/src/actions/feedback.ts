import { postApi } from '../api';
import * as types from '../constants/feedback';
import errors from '../errors';

export const openFeedbackModal = function() {
    return {
        type: types.OPEN_FEEDBACK_MODAL,
    };
};
export const closeFeedbackModal = function() {
    return {
        type: types.CLOSE_FEEDBACK_MODAL,
    };
};

// Create a new project

export function createFeedbackRequest() {
    return {
        type: types.CREATE_FEEDBACK_REQUEST,
    };
}

export function createFeedbackError(error) {
    return {
        type: types.CREATE_FEEDBACK_FAILED,
        payload: error,
    };
}

export function createFeedbackSuccess(project) {
    return {
        type: types.CREATE_FEEDBACK_SUCCESS,
        payload: project,
    };
}

export const resetCreateFeedback = () => {
    return {
        type: types.CREATE_FEEDBACK_RESET,
    };
};

// Calls the API to register a user.
export function createFeedback(projectId, feedback, page) {
    return function(dispatch) {
        const promise = postApi(`feedback/${projectId}`, { feedback, page });

        dispatch(createFeedbackRequest());

        return promise.then(
            function(feedback) {
                dispatch(createFeedbackSuccess(feedback));
                return feedback;
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
                dispatch(createFeedbackError(errors(error)));
            }
        );
    };
}
