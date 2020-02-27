import reducer from '../../reducers/modal';
import * as types from '../../constants/modal';

const initialState = {
    modals: [],
    feedbackModalVisble: false,
};

describe('Modal Reducers', () => {
    it('should return initial state', () => {
        expect(reducer(initialState, {})).toEqual(initialState);
    });

    it('should handle OPEN_MODAL', () => {
        const expected = {
            modals: [{ id: 'id OPEN_MODAL' }],
            feedbackModalVisble: false,
        };

        expect(
            reducer(initialState, {
                type: types.OPEN_MODAL,
                payload: [{ id: 'id OPEN_MODAL' }],
            })
        ).toEqual(expected);
    });

    it('should handle CLOSE_MODAL, return empty filter', () => {
        const expected = {
            modals: [],
            feedbackModalVisble: false,
        };

        initialState.modals = [{ id: 'id CLOSE_MODAL' }];

        expect(
            reducer(initialState, {
                type: types.CLOSE_MODAL,
                payload: { id: 'id CLOSE_MODAL' },
            })
        ).toEqual(expected);
    });

    it('should handle CLOSE_MODAL, return modals ', () => {
        const expected = {
            modals: [{ id: 'id CLOSE_MODAL' }],
            feedbackModalVisble: false,
        };

        initialState.modals = [{ id: 'id CLOSE_MODAL' }];

        expect(
            reducer(initialState, {
                type: types.CLOSE_MODAL,
                payload: { id: 'id_ CLOSE_MODAL' },
            })
        ).toEqual(expected);
    });
});
