import * as _actions from '../../actions/version';
import * as _types from '../../constants/version';

import axiosMock from '../axios_mock';
import {
    API_URL
} from '../../config';

/*
  Test for version actions.
*/
const actions = { ..._actions, ..._types };

describe('actions', () => {
    it('should create an action of type GET_VERSION_REQUEST', () => {
        let promise = Promise.resolve(true);
        const expectedAction = {
            type: actions.GET_VERSION_REQUEST,
        };
        let action = actions.getVersionRequest(promise);
        expect(action.type).toEqual(expectedAction.type);
        return action.payload.then((o) => {
            expect(o).toEqual(true);
        });
    })
})

describe('actions', () => {
    it('should create an action of type GET_VERSION_FAILED', () => {
        let error = 'error that will occur';
        const expectedAction = {
            type: actions.GET_VERSION_FAILED,
        };
        const action = actions.getVersionError(error);
        expect(action.type).toEqual(expectedAction.type);
        expect(action.payload).toEqual(error);
    })
})

describe('actions', () => {
    it('should create an action of type GET_VERSION_SUCCESS', () => {
        let versions = {};
        const expectedAction = {
            type: actions.GET_VERSION_SUCCESS,
        };
        const action = actions.getVersionSuccess(versions);
        expect(action.type).toEqual(expectedAction.type);
        expect(action.payload).toEqual(versions);
    })
})

describe('actions', () => {
    it('should create an action of type GET_VERSION_RESET', () => {
        const expectedAction = {
            type: actions.GET_VERSION_RESET,
        };
        expect(actions.resetGetVersion().type).toEqual(expectedAction.type);
    })
})

describe('actions', () => {
    it('should despatch GET_VERSION_FAILED with 404', () => {

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.GET_VERSION_REQUEST:
                    expect(dispatched.type).toEqual(actions.GET_VERSION_REQUEST);
                    break;
                case actions.GET_VERSION_SUCCESS:
                    expect(dispatched.type).toEqual(actions.GET_VERSION_SUCCESS);
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.GET_VERSION_FAILED);
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'));
            }
        }
        let action = actions.getVersion()(dispatch);
    })
})

describe('actions', () => {
    it('should despatch GET_VERSION_REQUEST and GET_VERSION_SUCCESS actions', () => {

        axiosMock.onGet(`${API_URL}/version`).reply(200, { data: 'success' }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.GET_VERSION_SUCCESS:
                    expect(dispatched.type).toEqual(actions.GET_VERSION_SUCCESS);
                    expect(dispatched.payload).toEqual({ data: 'success' });
                    break;
                case actions.GET_VERSION_REQUEST:
                    expect(dispatched.type).toEqual(actions.GET_VERSION_REQUEST);
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.GET_VERSION_FAILED);
                    expect(dispatched.payload).toEqual('fail test');
            }
        }
        let action = actions.getVersion()(dispatch);
    })
})