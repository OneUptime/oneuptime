import * as _actions from '../../actions/logout';
import * as _types from '../../constants/logout';

/*
  Test for logout actions.
*/

const actions = { ..._actions, ..._types };

describe('actions', () => {
    it('should create an action of type LOGOUT_REQUEST', () => {
        const action = actions.requestLogout();

        expect(action.type).toEqual(actions.LOGOUT_REQUEST);
        expect(action.isFetching).toEqual(true);
        expect(action.isAuthenticated).toEqual(true);
    });
});

describe('actions', () => {
    it('should create an action of type LOGOUT_SUCCESS', () => {
        const action = actions.receiveLogout();

        expect(action.type).toEqual(actions.LOGOUT_SUCCESS);
        expect(action.isFetching).toEqual(false);
        expect(action.isAuthenticated).toEqual(false);
    });
});

describe('actions', () => {
    it('should despatch logout actions', () => {
        const dispatch = dispatched => {
            switch (dispatched.type) {
                case actions.LOGOUT_REQUEST:
                    expect(dispatched.isFetching).toEqual(true);
                    expect(dispatched.isAuthenticated).toEqual(true);
                    break;
                case actions.LOGOUT_SUCCESS:
                    expect(dispatched.isFetching).toEqual(false);
                    expect(dispatched.isAuthenticated).toEqual(false);
                    break;
            }
        };
        actions.logoutUser()(dispatch);
    });
});
