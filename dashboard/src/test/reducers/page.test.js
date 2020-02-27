import reducer from '../../reducers/page';
import * as types from '../../constants/page';

const initialState = {
    requesting: false,
    title: '',
};

describe('Page Reducers', () => {
    it('should return initial state', () => {
        expect(reducer(initialState, {})).toEqual(initialState);
    });

    it('should handle PAGE_LOAD_REQUEST', () => {
        const payload = 'test page';
        const expected = {
            ...initialState,
            requesting: true,
            title: payload,
        };
        expect(
            reducer(initialState, {
                type: types.PAGE_LOAD_REQUEST,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle PAGE_LOAD_SUCCESS', () => {
        const payload = 'test page';
        const expected = {
            ...initialState,
            requesting: false,
            title: payload,
        };
        expect(
            reducer(initialState, {
                type: types.PAGE_LOAD_SUCCESS,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle PAGE_LOAD_RESET', () => {
        const expected = {
            ...initialState,
            requesting: false,
        };
        expect(reducer(initialState, { type: types.PAGE_LOAD_RESET })).toEqual(
            expected
        );
    });
});
