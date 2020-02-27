import reducer from '../../reducers/statusPage';
import * as types from '../../constants/statusPage';

const initialState = {
    setting: {
        error: null,
        requesting: false,
        success: false,
    },
    monitors: {
        error: null,
        requesting: false,
        success: false,
    },
    privateStatusPage: {
        error: null,
        requesting: false,
        success: false,
    },
    branding: {
        error: null,
        requesting: false,
        success: false,
    },
    links: {
        error: null,
        requesting: false,
        success: false,
    },
    logocache: {
        data: null,
    },
    faviconcache: {
        data: null,
    },
    deleteStatusPage: {
        success: false,
        requesting: false,
        error: null,
    },
    //this is for main status page object.
    error: null,
    requesting: false,
    success: false,
    status: {},
    statusPages: [],
    count: null,
    limit: null,
    skip: null,
    pages: {
        counter: 1,
    },
    subProjectStatusPages: [],
};

describe('StatusPage Reducers', () => {
    it('should return initial state', () => {
        expect(reducer(initialState, {})).toEqual(initialState);
    });

    it('should handle UPDATE_STATUSPAGE_SETTING_REQUEST action', () => {
        const expected = {
            ...initialState,
            setting: {
                requesting: true,
                error: null,
                success: false,
            },
        };
        expect(
            reducer(initialState, {
                type: types.UPDATE_STATUSPAGE_SETTING_REQUEST,
            })
        ).toEqual(expected);
    });

    it('should handle UPDATE_STATUSPAGE_SETTING_SUCCESS action', () => {
        const payload = { test: 'test' };
        const expected = {
            ...initialState,
            setting: {
                requesting: false,
                error: null,
                success: true,
            },
            status: { test: 'test' },
        };
        expect(
            reducer(initialState, {
                type: types.UPDATE_STATUSPAGE_SETTING_SUCCESS,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle UPDATE_STATUSPAGE_SETTING_FAILURE action', () => {
        const payload = 'some error';
        const expected = {
            ...initialState,
            setting: {
                requesting: false,
                error: payload,
                success: false,
            },
        };
        expect(
            reducer(initialState, {
                type: types.UPDATE_STATUSPAGE_SETTING_FAILURE,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle UPDATE_STATUSPAGE_SETTING_RESET action', () => {
        expect(
            reducer(initialState, {
                type: types.UPDATE_STATUSPAGE_SETTING_RESET,
            })
        ).toEqual(initialState);
    });

    it('should handle UPDATE_STATUSPAGE_MONITORS_REQUEST action', () => {
        const expected = {
            ...initialState,
            monitors: {
                requesting: true,
                error: null,
                success: false,
            },
        };
        expect(
            reducer(initialState, {
                type: types.UPDATE_STATUSPAGE_MONITORS_REQUEST,
            })
        ).toEqual(expected);
    });

    it('should handle UPDATE_STATUSPAGE_MONITORS_SUCCESS action', () => {
        const payload = { test: 'test' };
        const expected = {
            ...initialState,
            monitors: {
                requesting: false,
                error: null,
                success: true,
            },
            status: { test: 'test' },
        };
        expect(
            reducer(initialState, {
                type: types.UPDATE_STATUSPAGE_MONITORS_SUCCESS,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle UPDATE_STATUSPAGE_MONITORS_FAILURE action', () => {
        const payload = 'some error';
        const expected = {
            ...initialState,
            monitors: {
                requesting: false,
                error: payload,
                success: false,
            },
        };
        expect(
            reducer(initialState, {
                type: types.UPDATE_STATUSPAGE_MONITORS_FAILURE,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle UPDATE_STATUSPAGE_MONITORS_RESET action', () => {
        expect(
            reducer(initialState, {
                type: types.UPDATE_STATUSPAGE_MONITORS_RESET,
            })
        ).toEqual(initialState);
    });

    it('should handle UPDATE_STATUSPAGE_BRANDING_REQUEST action', () => {
        const expected = {
            ...initialState,
            branding: {
                requesting: true,
                error: null,
                success: false,
            },
        };
        expect(
            reducer(initialState, {
                type: types.UPDATE_STATUSPAGE_BRANDING_REQUEST,
            })
        ).toEqual(expected);
    });

    it('should handle UPDATE_STATUSPAGE_BRANDING_SUCCESS action', () => {
        const payload = { test: 'test' };
        const expected = {
            ...initialState,
            branding: {
                requesting: false,
                error: null,
                success: true,
            },
            status: { test: 'test' },
        };
        expect(
            reducer(initialState, {
                type: types.UPDATE_STATUSPAGE_BRANDING_SUCCESS,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle UPDATE_STATUSPAGE_BRANDING_FAILURE action', () => {
        const payload = 'some error';
        const expected = {
            ...initialState,
            branding: {
                requesting: false,
                error: payload,
                success: false,
            },
        };
        expect(
            reducer(initialState, {
                type: types.UPDATE_STATUSPAGE_BRANDING_FAILURE,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle UPDATE_STATUSPAGE_BRANDING_RESET action', () => {
        expect(
            reducer(initialState, {
                type: types.UPDATE_STATUSPAGE_BRANDING_RESET,
            })
        ).toEqual(initialState);
    });

    it('should handle UPDATE_STATUSPAGE_LINKS_REQUEST action', () => {
        const expected = {
            ...initialState,
            links: {
                requesting: true,
                error: null,
                success: false,
            },
        };
        expect(
            reducer(initialState, {
                type: types.UPDATE_STATUSPAGE_LINKS_REQUEST,
            })
        ).toEqual(expected);
    });

    it('should handle UPDATE_STATUSPAGE_LINKS_SUCCESS action', () => {
        const payload = { test: 'test' };
        const expected = {
            ...initialState,
            links: {
                requesting: false,
                error: null,
                success: true,
            },
            status: { test: 'test' },
        };
        expect(
            reducer(initialState, {
                type: types.UPDATE_STATUSPAGE_LINKS_SUCCESS,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle UPDATE_STATUSPAGE_LINKS_FAILURE action', () => {
        const payload = 'some error';
        const expected = {
            ...initialState,
            links: {
                requesting: false,
                error: payload,
                success: false,
            },
        };
        expect(
            reducer(initialState, {
                type: types.UPDATE_STATUSPAGE_LINKS_FAILURE,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle UPDATE_STATUSPAGE_LINKS_RESET action', () => {
        expect(
            reducer(initialState, { type: types.UPDATE_STATUSPAGE_LINKS_RESET })
        ).toEqual(initialState);
    });

    it('should handle FETCH_STATUSPAGE_REQUEST action', () => {
        const expected = {
            ...initialState,
            error: null,
            requesting: true,
            success: false,
            status: {},
        };
        expect(
            reducer(initialState, { type: types.FETCH_STATUSPAGE_REQUEST })
        ).toEqual(expected);
    });

    it('should handle FETCH_STATUSPAGE_FAILURE action', () => {
        const payload = 'some error';
        const expected = {
            ...initialState,
            status: {},
            requesting: false,
            success: false,
            error: payload,
        };
        expect(
            reducer(initialState, {
                type: types.FETCH_STATUSPAGE_FAILURE,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle FETCH_STATUSPAGE_RESET action', () => {
        const expected = {
            ...initialState,
            status: undefined,
        };
        expect(
            reducer(initialState, { type: types.FETCH_STATUSPAGE_RESET })
        ).toEqual(expected);
    });
    it('should handle FETCH_STATUSPAGE_SUCCESS action', () => {
        const payload = {
            count: 10,
            skip: 5,
            limit: 5,
            data: [],
        };
        const expected = {
            ...initialState,
            statusPages: payload.data,
            error: null,
            requesting: false,
            success: false,
            count: 10,
            skip: 5,
            limit: 5,
        };
        expect(
            reducer(initialState, {
                type: types.FETCH_STATUSPAGE_SUCCESS,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle DELETE_PROJECT_STATUSPAGES action', () => {
        const payload = '_id';
        const expected = {
            ...initialState,
            statusPage: [],
        };
        expect(
            reducer(initialState, {
                type: types.DELETE_PROJECT_STATUSPAGES,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle LOGO_CACHE_INSERT action', () => {
        const payload = 'file url';
        const expected = {
            ...initialState,
            logocache: {
                data: payload,
            },
        };
        expect(
            reducer(initialState, {
                type: types.LOGO_CACHE_INSERT,
                payload: payload,
            })
        ).toEqual(expected);
    });
    it('should handle FAVICON_CACHE_INSERT action', () => {
        const payload = 'file url';
        const expected = {
            ...initialState,
            faviconcache: {
                data: payload,
            },
        };
        expect(
            reducer(initialState, {
                type: types.FAVICON_CACHE_INSERT,
                payload: payload,
            })
        ).toEqual(expected);
    });
    it('should handle LOGO_CACHE_RESET action', () => {
        const payload = 'file url';
        const expected = {
            ...initialState,
            logocache: {
                data: null,
            },
        };
        expect(
            reducer(initialState, {
                type: types.LOGO_CACHE_RESET,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle FAVICON_CACHE_RESET action', () => {
        const payload = 'file url';
        const expected = {
            ...initialState,
            faviconcache: {
                data: null,
            },
        };
        expect(
            reducer(initialState, {
                type: types.FAVICON_CACHE_RESET,
                payload: payload,
            })
        ).toEqual(expected);
    });
});
