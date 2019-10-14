import reducer from '../../reducers/version';
import * as types from '../../constants/version';

const initialState = {
    versions: {
        requesting: false,
        error: null,
        success: false,
        server: '',
        client: ''
    }
};

import { version } from '../../package.json';

describe('Version Reducers', () => {

    it('should return initial state', () => {
        expect(reducer(initialState, {})).toEqual(initialState);
    });

    it('should handle GET_VERSION_REQUEST', () => {
        const expected = {
            versions: {
                ...initialState.versions,
                requesting: true
            }
        };
        expect(reducer(initialState, { type: types.GET_VERSION_REQUEST })).toEqual(expected);
    });

    it('should handle GET_VERSION_SUCCESS', () => {
        const payload = { server: version };
        const expected = {
            versions: {
                ...initialState.versions,
                requesting: false,
                success: true,
                server: payload.server,
                client: version
            }
        };
        expect(reducer(initialState, { type: types.GET_VERSION_SUCCESS, payload: payload })).toEqual(expected);
    });

    it('should handle GET_VERSION_FAILED', () => {
        const payload = 'some error';
        const expected = {
            versions: {
                ...initialState.versions,
                requesting: false,
                success: false,
                error: payload
            }
        };
        expect(reducer(initialState, { type: types.GET_VERSION_FAILED, payload: payload })).toEqual(expected);
    });

    it('should handle GET_VERSION_RESET', () => {
        const expected = {
            versions: {
                ...initialState.versions,
                requesting: false,
                success: false,
                error: null
            }
        };
        expect(reducer(initialState, { type: types.GET_VERSION_RESET })).toEqual(expected);
    });
});
