import reducer from '../../reducers/feedback';
import * as types from '../../constants/feedback';

const initialState = {
    feedback: {
        error: null,
        requesting: false,
        success: false,
    },
    feedbackModalVisble: false,
};

describe('Feedback Reducers', () => {
    it('should return initial state', () => {
        expect(reducer(initialState, {})).toEqual(initialState);
    });

    it('should handle OPEN_FEEDBACK_MODAL ', () => {
        const expected = {
            feedback: {
                error: null,
                requesting: false,
                success: false,
            },
            feedbackModalVisble: true,
        };
        expect(
            reducer(initialState, { type: types.OPEN_FEEDBACK_MODAL })
        ).toEqual(expected);
    });

    it('should handle CREATE_FEEDBACK_SUCCESS', () => {
        const expected = {
            feedback: {
                requesting: false,
                success: true,
                error: null,
            },
            feedbackModalVisble: false,
        };
        expect(
            reducer(initialState, { type: types.CREATE_FEEDBACK_SUCCESS })
        ).toEqual(expected);
    });

    it('should handle CREATE_FEEDBACK_FAILED', () => {
        const expected = {
            feedback: {
                error: 'error that will occur',
                requesting: false,
                success: false,
            },
            feedbackModalVisble: false,
        };
        expect(
            reducer(initialState, {
                type: types.CREATE_FEEDBACK_FAILED,
                payload: expected.feedback.error,
            })
        ).toEqual(expected);
    });

    it('should handle CLOSE_FEEDBACK_MODAL ', () => {
        expect(
            reducer(initialState, { type: types.CLOSE_FEEDBACK_MODAL })
        ).toEqual(initialState);
    });

    it('should handle CREATE_FEEDBACK_REQUEST ', () => {
        const expected = {
            requesting: true,
            error: null,
            success: false,
        };
        expect(
            reducer(initialState, { type: types.CREATE_FEEDBACK_REQUEST })
                .feedback
        ).toEqual(expected);
    });
});
