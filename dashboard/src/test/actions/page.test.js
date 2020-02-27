import * as _actions from '../../actions/page';
import * as _types from '../../constants/page';

/*
  Test for page actions.
*/
const actions = { ..._actions, ..._types };

describe('actions', () => {
    it('should create an action of type PAGE_LOAD_REQUEST', () => {
        const title = 'test page';
        const expectedAction = {
            type: actions.PAGE_LOAD_REQUEST,
        };
        const action = actions.pageLoadRequest(title);
        expect(action.type).toEqual(expectedAction.type);
        expect(action.payload).toEqual(title);
    });
});

describe('actions', () => {
    it('should create an action of type PAGE_LOAD_SUCCESS', () => {
        const title = 'test page';
        const expectedAction = {
            type: actions.PAGE_LOAD_SUCCESS,
        };
        const action = actions.pageLoadSuccess(title);
        expect(action.type).toEqual(expectedAction.type);
        expect(action.payload).toEqual(title);
    });
});

describe('actions', () => {
    it('should create an action of type GET_VERSION_RESET', () => {
        const expectedAction = {
            type: actions.PAGE_LOAD_RESET,
        };
        expect(actions.resetPageLoad().type).toEqual(expectedAction.type);
    });
});

describe('actions', () => {
    it('should despatch PAGE_LOAD_REQUEST and PAGE_LOAD_SUCCESS actions', () => {
        const dispatch = dispatched => {
            switch (dispatched.type) {
                case actions.PAGE_LOAD_REQUEST:
                    expect(dispatched.type).toEqual(actions.PAGE_LOAD_REQUEST);
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.PAGE_LOAD_SUCCESS);
                    expect(dispatched.payload).toEqual('test page');
                    break;
            }
        };
        actions.loadPage('test page')(dispatch);
    });
});
