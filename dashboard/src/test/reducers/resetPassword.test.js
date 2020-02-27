import reducer from '../../reducers/resetPassword';
import * as types from '../../constants/resetPassword';

const initialState = {
    requesting: false,
    error: null,
    success: false,
};

describe('Reset Password Reducers', () => {
    it('should return initial state', () => {
        expect(reducer(initialState, {})).toEqual(initialState);
    });

    it('should handle PASSWORDRESET_REQUEST', () => {
        const expected = {
            ...initialState,
            requesting: true,
            error: null,
        };
        expect(
            reducer(initialState, { type: types.PASSWORDRESET_REQUEST })
        ).toEqual(expected);
    });

    it('should handle PASSWORDRESET_SUCCESS', () => {
        const expected = {
            ...initialState,
            requesting: false,
            success: true,
            error: null,
        };
        expect(
            reducer(initialState, { type: types.PASSWORDRESET_SUCCESS })
        ).toEqual(expected);
    });

    it('should handle PASSWORDRESET_SUCCESS', () => {
        const expected = {
            ...initialState,
            requesting: false,
            success: true,
            error: null,
        };
        expect(
            reducer(initialState, { type: types.PASSWORDRESET_SUCCESS })
        ).toEqual(expected);
    });

    it('should handle PASSWORDRESET_FAILED', () => {
        const payload = 'some error';
        const expected = {
            ...initialState,
            requesting: false,
            success: false,
            error: payload,
        };
        expect(
            reducer(initialState, {
                type: types.PASSWORDRESET_FAILED,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle RESET_PASSWORDRESET', () => {
        const expected = {
            ...initialState,
            requesting: false,
            success: false,
            error: null,
        };
        expect(
            reducer(initialState, { type: types.RESET_PASSWORDRESET })
        ).toEqual(expected);
    });
});
