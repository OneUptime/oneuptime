import reducer from '../../reducers/tutorial';
import * as types from '../../constants/tutorial';

const initialState = {
    error: null,
    requesting: false,
    success: false,
    monitor: {
        show: true
    },
    incident: {
        show: true
    },
    statusPage: {
        show: true
    },
    callSchedule: {
        show: true
    }
};

describe('Tutorial Reducers', () => {

    it('should return initial state', () => {
        expect(reducer(initialState, {})).toEqual(initialState);
    });

    it('should handle FETCH_TUTORIAL_REQUEST', () => {
        const expected = {
            ...initialState,
            error: null,
            requesting: true,
            success: false
        };
        expect(reducer(initialState, { type: types.FETCH_TUTORIAL_REQUEST })).toEqual(expected);
    });

    it('should handle FETCH_TUTORIAL_SUCCESS', () => {
        const payload = {
            data: {
                monitor: {
                    show: false
                }
            }
        };
        const expected = {
            ...initialState,
            error: null,
            requesting: false,
            success: true,
            ...payload.data
        };
        expect(reducer(initialState, { type: types.FETCH_TUTORIAL_SUCCESS, payload: payload })).toEqual(expected);
    });

    it('should handle FETCH_TUTORIAL_FAILURE', () => {
        const payload = 'some error';
        const expected = {
            ...initialState,
            error: payload,
            requesting: false,
            success: false
        };
        expect(reducer(initialState, { type: types.FETCH_TUTORIAL_FAILURE, payload: payload })).toEqual(expected);
    });

    it('should handle FETCH_TUTORIAL_RESET', () => {
        const expected = {
            error: null,
            requesting: false,
            success: false,
            monitor: {
                show: true
            },
            incident: {
                show: true
            },
            statusPage: {
                show: true
            },
            callSchedule: {
                show: true
            }
        };
        expect(reducer(initialState, { type: types.FETCH_TUTORIAL_RESET })).toEqual(expected);
    });

    it('should handle CLOSE_TUTORIAL_REQUEST', () => {
        const expected = {
            ...initialState,
            error: null,
            requesting: true,
            success: false
        };
        expect(reducer(initialState, { type: types.CLOSE_TUTORIAL_REQUEST })).toEqual(expected);
    });

    it('should handle CLOSE_TUTORIAL_SUCCESS', () => {
        const payload = {
            data: {
                monitor: {
                    show: false
                }
            }
        };
        const expected = {
            ...initialState,
            error: null,
            requesting: false,
            success: true,
            ...payload.data
        };
        expect(reducer(initialState, { type: types.CLOSE_TUTORIAL_SUCCESS, payload: payload })).toEqual(expected);
    });

    it('should handle CLOSE_TUTORIAL_FAILURE', () => {
        const payload = 'some error';
        const expected = {
            ...initialState,
            error: payload,
            requesting: false,
            success: false
        };
        expect(reducer(initialState, { type: types.CLOSE_TUTORIAL_FAILURE, payload: payload })).toEqual(expected);
    });

    it('should handle CLOSE_TUTORIAL_RESET', () => {
        const expected = {
            ...initialState,
            error: null,
            requesting: false,
            success: false
        };
        expect(reducer(initialState, { type: types.CLOSE_TUTORIAL_RESET })).toEqual(expected);
    });
});
