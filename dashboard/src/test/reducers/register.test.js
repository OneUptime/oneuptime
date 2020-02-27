import reducer from '../../reducers/register';
import * as types from '../../constants/register';

const initialState = {
    requesting: false,
    step: 1,
    user: {},
    card: {},
    company: {},
    error: null,
    success: false,
    isUserInvited: {
        requesting: false,
        isUserInvited: null,
        error: null,
        success: false,
    },
};

describe('Register Reducers', () => {
    it('should return initial state', () => {
        expect(reducer(initialState, {})).toEqual(initialState);
    });

    it('should handle SIGNUP_REQUEST', () => {
        const expected = {
            ...initialState,
            requesting: true,
            error: null,
        };
        expect(reducer(initialState, { type: types.SIGNUP_REQUEST })).toEqual(
            expected
        );
    });

    it('should handle SIGNUP_SUCCESS', () => {
        const expected = {
            ...initialState,
            requesting: false,
            success: true,
            error: null,
        };
        expect(reducer(initialState, { type: types.SIGNUP_SUCCESS })).toEqual(
            expected
        );
    });

    it('should handle SIGNUP_FAILED', () => {
        const payload = 'some error';
        const expected = {
            ...initialState,
            requesting: false,
            isAuthenticated: false,
            error: payload,
            step: 1,
            isUserInvited: {
                ...initialState.isUserInvited,
                requesting: false,
            },
        };
        expect(
            reducer(initialState, {
                type: types.SIGNUP_FAILED,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle SIGNUP_SUCCESS', () => {
        const expected = {
            ...initialState,
            requesting: false,
            success: true,
            error: null,
        };
        expect(reducer(initialState, { type: types.SIGNUP_SUCCESS })).toEqual(
            expected
        );
    });

    it('should handle SIGNUP_STEP_INC', () => {
        const expected = {
            ...initialState,
            step: 2,
            error: null,
        };
        expect(reducer(initialState, { type: types.SIGNUP_STEP_INC })).toEqual(
            expected
        );
    });

    it('should handle SKIP_CARD_STEP', () => {
        const expected = {
            ...initialState,
            step: 3,
            error: null,
        };
        expect(reducer(initialState, { type: types.SKIP_CARD_STEP })).toEqual(
            expected
        );
    });

    it('should handle SIGNUP_STEP_DEC', () => {
        initialState.step = 5;
        const expected = {
            ...initialState,
            step: 4,
            error: null,
        };
        expect(reducer(initialState, { type: types.SIGNUP_STEP_DEC })).toEqual(
            expected
        );
    });

    it('should handle SKIP_CARD_STEP', () => {
        const expected = {
            ...initialState,
            step: 3,
            error: null,
        };
        expect(reducer(initialState, { type: types.SKIP_CARD_STEP })).toEqual(
            expected
        );
    });

    it('should handle SAVE_USER_STATE', () => {
        const payload = { _id: '_id' };
        const expected = {
            ...initialState,
            user: payload,
        };
        expect(
            reducer(initialState, {
                type: types.SAVE_USER_STATE,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle SAVE_CARD_STATE', () => {
        const payload = { _id: '_id' };
        const expected = {
            ...initialState,
            card: payload,
        };
        expect(
            reducer(initialState, {
                type: types.SAVE_CARD_STATE,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle SAVE_COMPANY_STATE', () => {
        const payload = { _id: '_id' };
        const expected = {
            ...initialState,
            company: payload,
        };
        expect(
            reducer(initialState, {
                type: types.SAVE_COMPANY_STATE,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle RESET_SIGNUP', () => {
        const expected = {
            requesting: false,
            step: 1,
            user: {},
            card: {},
            company: {},
            error: null,
            success: false,
            isUserInvited: {
                requesting: false,
                isUserInvited: null,
                error: null,
                success: false,
            },
        };
        expect(reducer(initialState, { type: types.RESET_SIGNUP })).toEqual(
            expected
        );
    });

    it('should handle IS_USER_INVITED_FAILED', () => {
        const payload = 'some error';
        const expected = {
            ...initialState,
            isUserInvited: {
                requesting: false,
                isUserInvited: null,
                error: payload,
                success: false,
            },
        };
        expect(
            reducer(initialState, {
                type: types.IS_USER_INVITED_FAILED,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle IS_USER_INVITED_REQUEST', () => {
        const payload = { _id: '_id' };
        const expected = {
            ...initialState,
            isUserInvited: {
                requesting: true,
                isUserInvited: null,
                error: null,
                success: false,
            },
        };
        expect(
            reducer(initialState, {
                type: types.IS_USER_INVITED_REQUEST,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle IS_USER_INVITED_REQUEST', () => {
        const payload = { _id: '_id' };
        const expected = {
            ...initialState,
            isUserInvited: {
                requesting: true,
                isUserInvited: null,
                error: null,
                success: false,
            },
        };
        expect(
            reducer(initialState, {
                type: types.IS_USER_INVITED_REQUEST,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle IS_USER_INVITED_SUCCESS', () => {
        const payload = true;
        const expected = {
            ...initialState,
            isUserInvited: {
                requesting: false,
                isUserInvited: payload,
                error: null,
                success: false,
            },
        };

        expect(
            reducer(initialState, {
                type: types.IS_USER_INVITED_SUCCESS,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle IS_USER_INVITED_RESET', () => {
        const expected = {
            ...initialState,
            isUserInvited: {
                requesting: false,
                isUserInvited: null,
                error: null,
                success: false,
            },
        };

        expect(
            reducer(initialState, { type: types.IS_USER_INVITED_RESET })
        ).toEqual(expected);
    });
});
