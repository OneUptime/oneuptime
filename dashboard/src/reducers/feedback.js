import {
    OPEN_FEEDBACK_MODAL,
    CLOSE_FEEDBACK_MODAL,
    CREATE_FEEDBACK_FAILED,
    CREATE_FEEDBACK_REQUEST,
    CREATE_FEEDBACK_SUCCESS,
} from '../constants/feedback';

const initialState = {
    feedback: {
        error: null,
        requesting: false,
        success: false,
    },
    feedbackModalVisble: false,
};

export default (state = initialState, action) => {
    switch (action.type) {
        case OPEN_FEEDBACK_MODAL:
            return Object.assign({}, state, {
                feedbackModalVisble: true,
            });

        case CLOSE_FEEDBACK_MODAL:
            return Object.assign({}, state, {
                feedbackModalVisble: false,
            });

        case CREATE_FEEDBACK_FAILED:
            return Object.assign({}, state, {
                feedback: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case CREATE_FEEDBACK_SUCCESS:
            return Object.assign({}, state, {
                feedback: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            });

        case CREATE_FEEDBACK_REQUEST:
            return Object.assign({}, state, {
                feedback: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        default:
            return state;
    }
};
