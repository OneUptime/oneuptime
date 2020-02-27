import * as _actions from '../../actions/modal';
import * as _types from '../../constants/modal';

/*
  Test for modal actions.
*/

const actions = { ..._actions, ..._types };

describe('actions', () => {
    it('should create an action of type OPEN_MODAL', () => {
        const action = actions.openModal({});

        expect(action.type).toEqual(actions.OPEN_MODAL);
        expect(action.payload).toEqual({});
    });
});

describe('actions', () => {
    it('should create an action of type CLOSE_MODAL', () => {
        const action = actions.closeModal({});

        expect(action.type).toEqual(actions.CLOSE_MODAL);
        expect(action.payload).toEqual({});
    });
});
