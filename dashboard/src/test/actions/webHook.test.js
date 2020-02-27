import * as _actions from '../../actions/webHook';
import * as _types from '../../constants/webHook';

/*
  Test for WebHooks actions.
  General alerts
*/
const actions = { ..._actions, ..._types };

describe('actions', () => {
    it('should create an action of type GET_WEB_HOOK_RESET', () => {
        const expectedAction = {
            type: actions.GET_WEB_HOOK_RESET,
        };
        expect(actions.resetGetWebHook().type).toEqual(expectedAction.type);
    });
});

describe('actions', async () => {
    it('should create an action of type GET_WEB_HOOK_REQUEST, and Return promise in payload', () => {
        const promise = Promise.resolve('Webhooks list fetch response');
        const action = actions.getWebHookRequest(promise);

        expect(action.type).toEqual(actions.GET_WEB_HOOK_REQUEST);
        return action.payload.then(o => {
            expect(o).toEqual('Webhooks list fetch response');
        });
    });
});

describe('actions', () => {
    it('should create an action of type GET_WEB_HOOK_FAILED', () => {
        const expectedAction = {
            type: actions.GET_WEB_HOOK_FAILED,
            payload: 'error that occurred',
        };
        const action = actions.getWebHookError('error that occurred');
        expect(action.type).toEqual(expectedAction.type);
        expect(action.payload).toEqual(expectedAction.payload);
    });
});

describe('actions', () => {
    it('should create an action of type GET_WEB_HOOK_SUCCESS or GET_WEB_HOOK_FAILED , and webhook in payload', () => {
        const action = actions.getWebHookSuccess([]);
        expect(action.type).toEqual(actions.GET_WEB_HOOK_SUCCESS);
        expect(action.payload).toEqual([]);
    });
});

describe('actions', () => {
    it('should create an action of type DELETE_WEB_HOOK_RESET', () => {
        const expectedAction = {
            type: actions.DELETE_WEB_HOOK_RESET,
        };
        expect(actions.resetDeleteWebHook().type).toEqual(expectedAction.type);
    });
});

describe('actions', async () => {
    it('should create an action of type DELETE_WEB_HOOK_REQUEST, and Return promise in payload', () => {
        const promise = Promise.resolve('webhook delete response');
        const action = actions.deleteWebHookRequest(promise);

        expect(action.type).toEqual(actions.DELETE_WEB_HOOK_REQUEST);
    });
});

describe('actions', () => {
    it('should create an action of type DELETE_WEB_HOOK_FAILED', () => {
        const expectedAction = {
            type: actions.DELETE_WEB_HOOK_FAILED,
            payload: 'error that occurred',
        };
        const action = actions.deleteWebHookError('error that occurred');
        expect(action.type).toEqual(expectedAction.type);
        expect(action.payload).toEqual(expectedAction.payload);
    });
});

describe('actions', () => {
    it('should create an action of type DELETE_WEB_HOOK_SUCCESS or DELETE_WEB_HOOK_FAILED , and webhooks in payload', () => {
        const action = actions.deleteWebHookSuccess({});
        expect(action.type).toEqual(actions.DELETE_WEB_HOOK_SUCCESS);
        expect(action.payload).toEqual({});
    });
});

describe('actions', () => {
    it('should create an action of type CREATE_WEB_HOOK_RESET', () => {
        const expectedAction = {
            type: actions.CREATE_WEB_HOOK_RESET,
        };
        expect(actions.resetCreateWebHook().type).toEqual(expectedAction.type);
    });
});

describe('actions', async () => {
    it('should create an action of type CREATE_WEB_HOOK_REQUEST, and Return promise in payload', () => {
        const promise = Promise.resolve('webhook created response');
        const action = actions.createWebHookRequest(promise);

        expect(action.type).toEqual(actions.CREATE_WEB_HOOK_REQUEST);
    });
});

describe('actions', () => {
    it('should create an action of type CREATE_WEB_HOOK_FAILED', () => {
        const expectedAction = {
            type: actions.CREATE_WEB_HOOK_FAILED,
            payload: 'error that occurred',
        };
        const action = actions.createWebHookError('error that occurred');
        expect(action.type).toEqual(expectedAction.type);
        expect(action.payload).toEqual(expectedAction.payload);
    });
});

describe('actions', () => {
    it('should create an action of type CREATE_WEB_HOOK_SUCCESS or CREATE_WEB_HOOK_FAILED , and webhooks in payload', () => {
        const action = actions.createWebHookSuccess({});
        expect(action.type).toEqual(actions.CREATE_WEB_HOOK_SUCCESS);
        expect(action.payload).toEqual({});
    });
});

describe('actions', () => {
    it('should create an action of type UPDATE_WEB_HOOK_RESET', () => {
        const expectedAction = {
            type: actions.UPDATE_WEB_HOOK_RESET,
        };
        expect(actions.resetUpdateWebHook().type).toEqual(expectedAction.type);
    });
});

describe('actions', async () => {
    it('should create an action of type UPDATE_WEB_HOOK_REQUEST, and Return promise in payload', () => {
        const promise = Promise.resolve('webhook updated response');
        const action = actions.updateWebHookRequest(promise);

        expect(action.type).toEqual(actions.UPDATE_WEB_HOOK_REQUEST);
    });
});

describe('actions', () => {
    it('should create an action of type UPDATE_WEB_HOOK_FAILED', () => {
        const expectedAction = {
            type: actions.UPDATE_WEB_HOOK_FAILED,
            payload: 'error that occurred',
        };
        const action = actions.updateWebHookError('error that occurred');
        expect(action.type).toEqual(expectedAction.type);
        expect(action.payload).toEqual(expectedAction.payload);
    });
});

describe('actions', () => {
    it('should create an action of type UPDATE_WEB_HOOK_SUCCESS or UPDATE_WEB_HOOK_FAILED , and webhooks in payload', () => {
        const action = actions.updateWebHookSuccess({});
        expect(action.type).toEqual(actions.UPDATE_WEB_HOOK_SUCCESS);
        expect(action.payload).toEqual({});
    });
});

// pagination for Webhooks table

describe('actions', () => {
    it('should create an action of type PAGINATE_NEXT', () => {
        const expectedAction = {
            type: actions.PAGINATE_NEXT,
        };
        const action = actions.paginateNext();
        expect(action.type).toEqual(expectedAction.type);
    });
});
describe('actions', () => {
    it('should create an action of type PAGINATE_PREV', () => {
        const expectedAction = {
            type: actions.PAGINATE_PREV,
        };
        const action = actions.paginatePrev();
        expect(action.type).toEqual(expectedAction.type);
    });
});
describe('actions', () => {
    it('should create an action of type PAGINATE_RESET', () => {
        const expectedAction = {
            type: actions.PAGINATE_RESET,
        };
        const action = actions.paginateReset();
        expect(action.type).toEqual(expectedAction.type);
    });
});
describe('actions', () => {
    it('should dispatch action of type PAGINATE_NEXT', () => {
        const dispatch = dispatched => {
            expect(dispatched.type).toEqual(actions.PAGINATE_NEXT);
        };
        actions.paginate('next')(dispatch);
    });
});
describe('actions', () => {
    it('should dispatch action of type PAGINATE_PREV', () => {
        const dispatch = dispatched => {
            expect(dispatched.type).toEqual(actions.PAGINATE_PREV);
        };
        actions.paginate('prev')(dispatch);
    });
});
describe('actions', () => {
    it('should dispatch action of type PAGINATE_RESET', () => {
        const dispatch = dispatched => {
            expect(dispatched.type).toEqual(actions.PAGINATE_RESET);
        };
        actions.paginate('reset')(dispatch);
    });
});
