import * as _actions from '../../actions/tutorial';
import * as _types from '../../constants/tutorial';

import axiosMock from '../axios_mock';
import { API_URL } from '../../config';

/*
  Test for tutorial actions.
*/
const actions = { ..._actions, ..._types };

describe('actions', () => {
    it('should create an action of type FETCH_TUTORIAL_REQUEST', () => {
        const promise = Promise.resolve(true);
        const action = actions.fetchTutorialRequest(promise);

        expect(action.type).toEqual(actions.FETCH_TUTORIAL_REQUEST);
        return action.payload.then(o => {
            expect(o).toEqual(true);
        });
    });
});

describe('actions', () => {
    it('should create an action of type FETCH_TUTORIAL_SUCCESS', () => {
        const tutorial = {};
        const action = actions.fetchTutorialSuccess(tutorial);

        expect(action.type).toEqual(actions.FETCH_TUTORIAL_SUCCESS);
        expect(action.payload).toEqual(tutorial);
    });
});

describe('actions', () => {
    it('should create an action of type FETCH_TUTORIAL_FAILURE', () => {
        const error = 'error that will occur';
        const action = actions.fetchTutorialError(error);

        expect(action.type).toEqual(actions.FETCH_TUTORIAL_FAILURE);
        expect(action.payload).toEqual(error);
    });
});

describe('actions', () => {
    it('should create an action of type FETCH_TUTORIAL_RESET', () => {
        expect(actions.resetFetchTutorial().type).toEqual(
            actions.FETCH_TUTORIAL_RESET
        );
    });
});

describe('actions', () => {
    it('should create an action of type CLOSE_TUTORIAL_REQUEST', () => {
        const promise = Promise.resolve(true);
        const action = actions.closeTutorialRequest(promise);

        expect(action.type).toEqual(actions.CLOSE_TUTORIAL_REQUEST);
        return action.payload.then(o => {
            expect(o).toEqual(true);
        });
    });
});

describe('actions', () => {
    it('should create an action of type CLOSE_TUTORIAL_SUCCESS', () => {
        const tutorial = {};
        const action = actions.closeTutorialSuccess(tutorial);

        expect(action.type).toEqual(actions.CLOSE_TUTORIAL_SUCCESS);
        expect(action.payload).toEqual(tutorial);
    });
});

describe('actions', () => {
    it('should create an action of type CLOSE_TUTORIAL_FAILURE', () => {
        const error = 'error that will occur';
        const action = actions.closeTutorialError(error);

        expect(action.type).toEqual(actions.CLOSE_TUTORIAL_FAILURE);
        expect(action.payload).toEqual(error);
    });
});

describe('actions', () => {
    it('should create an action of type CLOSE_TUTORIAL_RESET', () => {
        expect(actions.resetCloseTutorial().type).toEqual(
            actions.CLOSE_TUTORIAL_RESET
        );
    });
});

describe('actions', () => {
    it('should despatch FETCH_TUTORIAL_FAILURE with 404', () => {
        const dispatch = dispatched => {
            switch (dispatched.type) {
                case actions.FETCH_TUTORIAL_REQUEST:
                    expect(dispatched.type).toEqual(
                        actions.FETCH_TUTORIAL_REQUEST
                    );
                    break;
                case actions.FETCH_TUTORIAL_SUCCESS:
                    expect(dispatched.type).toEqual(
                        actions.FETCH_TUTORIAL_SUCCESS
                    );
                    break;
                default:
                    expect(dispatched.type).toEqual(
                        actions.FETCH_TUTORIAL_FAILURE
                    );
                    expect(dispatched.payload).toEqual(
                        Error('Request failed with status code 404')
                    );
            }
        };

        actions.fetchTutorial()(dispatch);
    });
});

describe('actions', () => {
    it('should despatch CLOSE_TUTORIAL_FAILURE with 404', () => {
        const dispatch = dispatched => {
            switch (dispatched.type) {
                case actions.CLOSE_TUTORIAL_REQUEST:
                    expect(dispatched.type).toEqual(
                        actions.CLOSE_TUTORIAL_REQUEST
                    );
                    break;
                case actions.CLOSE_TUTORIAL_SUCCESS:
                    expect(dispatched.type).toEqual(
                        actions.CLOSE_TUTORIAL_SUCCESS
                    );
                    break;
                default:
                    expect(dispatched.type).toEqual(
                        actions.CLOSE_TUTORIAL_FAILURE
                    );
                    expect(dispatched.payload).toEqual(
                        Error('Request failed with status code 404')
                    );
            }
        };

        actions.closeTutorial('type')(dispatch);
    });
});

describe('actions', () => {
    it('should despatch FETCH_TUTORIAL_REQUEST and FETCH_TUTORIAL_SUCCESS actions', () => {
        axiosMock
            .onGet(`${API_URL}/tutorial`)
            .reply(200, { data: 'success' }, {});

        const dispatch = dispatched => {
            switch (dispatched.type) {
                case actions.FETCH_TUTORIAL_SUCCESS:
                    expect(dispatched.type).toEqual(
                        actions.FETCH_TUTORIAL_SUCCESS
                    );
                    expect(dispatched.payload).toEqual({ data: 'success' });
                    break;
                case actions.FETCH_TUTORIAL_REQUEST:
                    expect(dispatched.type).toEqual(
                        actions.FETCH_TUTORIAL_REQUEST
                    );
                    break;
                default:
                    expect(dispatched.type).toEqual(
                        actions.FETCH_TUTORIAL_FAILURE
                    );
                    expect(dispatched.payload).toEqual('fail test');
            }
        };

        actions.fetchTutorial()(dispatch);
    });
});

describe('actions', () => {
    it('should despatch CLOSE_TUTORIAL_REQUEST and CLOSE_TUTORIAL_SUCCESS actions', () => {
        axiosMock
            .onPut(`${API_URL}/tutorial`)
            .reply(200, { data: 'success' }, {});

        const dispatch = dispatched => {
            switch (dispatched.type) {
                case actions.CLOSE_TUTORIAL_SUCCESS:
                    expect(dispatched.type).toEqual(
                        actions.CLOSE_TUTORIAL_SUCCESS
                    );
                    expect(dispatched.payload).toEqual({ data: 'success' });
                    break;
                case actions.CLOSE_TUTORIAL_REQUEST:
                    expect(dispatched.type).toEqual(
                        actions.CLOSE_TUTORIAL_REQUEST
                    );
                    break;
                default:
                    expect(dispatched.type).toEqual(
                        actions.CLOSE_TUTORIAL_FAILURE
                    );
                    expect(dispatched.payload).toEqual('fail test');
            }
        };

        actions.closeTutorial('type')(dispatch);
    });
});
