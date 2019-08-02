import reducer from '../../reducers/webHook'
import * as types from '../../constants/webHook'


const initialState = {
    webHook:{
        error:null,
        requesting: false,
        success:false,
        webHooks:[],
        count: null,
        limit: null,
        skip: null
    },
    deleteWebHook: {
        error:null,
        requesting: false,
        success:false,
    },
    createWebHook: {
        error:null,
        requesting: false,
        success:false,
    },
    updateWebHook: {
        error:null,
        requesting: false,
        success:false,
    },
    pages: {
		counter: 0
	}
};

describe('WebHook Integration Reducers',()=>{

    it('should return initial state', () => {
        expect(reducer(initialState,{})).toEqual(initialState)
    });

    it('should handle GET_WEB_HOOK_SUCCESS', () => {
        const payload = { data: [{_id:'_id'}], count: 1, skip: 0, limit: 10};
        const expected  = {
            ...initialState,
            webHook: {
                requesting: false,
                error: null,
                success: true,
                webHooks: payload.data,
                count: payload.count,
                limit: payload.limit,
                skip: payload.skip
            },
        };
        expect(reducer(initialState,{type:types.GET_WEB_HOOK_SUCCESS, payload:payload})).toEqual(expected)
    });

    it('should handle GET_WEB_HOOK_REQUEST', () => {
        initialState.webHook.webHooks = [{_id:'_id'}]
        const expected  = {
            ...initialState,
            webHook: {
                requesting: true,
                success: false,
                error: null,
                webHooks:[],
                count: null,
                limit: null,
                skip: null
            }
        };
        expect(reducer(initialState,{type:types.GET_WEB_HOOK_REQUEST})).toEqual(expected)
    });

    it('should handle GET_WEB_HOOK_FAILED', () => {
        const payload = 'some error'
        const expected  = {
            ...initialState,
            webHook: {
                requesting: false,
                error: payload,
                success: false,
                webHooks: [],
                count: null,
                limit: null,
                skip: null
            },
        };
        expect(reducer(initialState,{type:types.GET_WEB_HOOK_FAILED,payload:payload})).toEqual(expected)
    });

    it('should handle GET_WEB_HOOK_RESET', () => {
        const expected  = {
            ...initialState,
            webHook: {
                requesting: false,
                error: null,
                success: false,
                webHooks: [],
                count: null,
                limit: null,
                skip: null
            },
        };
        expect(reducer(initialState,{type:types.GET_WEB_HOOK_RESET})).toEqual(expected)
    });

    it('should handle DELETE_WEB_HOOK_SUCCESS', () => {
        initialState.webHook.webHooks = [{_id:'_id', integrationType:'webhook'}]
        const payload = [{_id:'_id', integrationType:'webhook'}];
        const count = initialState.webHook.count - 1;
        const expected  = {
            ...initialState,
            webHook: {
                requesting: false,
                error: null,
                success: true,
                webHooks: [],
                skip: initialState.webHook.skip,
                limit: initialState.webHook.limit,
                count: count
            },
            deleteWebHook: {
                requesting: false,
                error: null,
                success: true,
            }
        };
        expect(reducer(initialState,{type:types.DELETE_WEB_HOOK_SUCCESS, payload:payload})).toEqual(expected)
    });

    it('should handle DELETE_WEB_HOOK_REQUEST', () => {
        const expected  = {
            ...initialState,
            deleteWebHook: {
                requesting: true,
                success: false,
                error: null
            }
        };
        expect(reducer(initialState,{type:types.DELETE_WEB_HOOK_REQUEST})).toEqual(expected)
    });

    it('should handle DELETE_WEB_HOOK_FAILED', () => {
        const payload = 'some error'
        const expected  = {
            ...initialState,
            deleteWebHook: {
                requesting: false,
                error: payload,
                success: false,
            },
        };
        expect(reducer(initialState,{type:types.DELETE_WEB_HOOK_FAILED, payload:payload})).toEqual(expected)
    });

    it('should handle DELETE_WEB_HOOK_RESET', () => {
        const expected  = {
            ...initialState,
            deleteWebHook: {
                requesting: false,
                success: false,
                error: null
            },
        };
        expect(reducer(initialState,{type:types.DELETE_WEB_HOOK_RESET})).toEqual(expected)
    });

    it('should handle CREATE_WEB_HOOK_SUCCESS', () => {
        initialState.webHook.webHooks = [{_id:'_id', integrationType:'webhook'}];
        const payload = [{_id:'_id', integrationType:'webhook'}];
        const count = initialState.webHook.count + 1;
        const expected  = {
            ...initialState,
            webHook: {
                requesting: false,
                error: null,
                success: true,
                webHooks: payload,
                skip: initialState.webHook.skip,
                limit: initialState.webHook.limit,
                count: count
            },
            createWebHook: {
                requesting: false,
                error: null,
                success: true,
            }
        };
        expect(reducer(initialState,{type:types.CREATE_WEB_HOOK_SUCCESS, payload:payload})).toEqual(expected)
    });

    it('should handle CREATE_WEB_HOOK_REQUEST', () => {
        const expected  = {
            ...initialState,
            createWebHook: {
                requesting: true,
                success: false,
                error: null
            }
        };
        expect(reducer(initialState,{type:types.CREATE_WEB_HOOK_REQUEST})).toEqual(expected)
    });

    it('should handle CREATE_WEB_HOOK_FAILED', () => {
        const payload = 'some error';
        const expected  = {
            ...initialState,
            createWebHook: {
                requesting: false,
                error: payload,
                success: false,
            },
        };
        expect(reducer(initialState, {type: types.CREATE_WEB_HOOK_FAILED, payload: payload})).toEqual(expected)
    });

    it('should handle CREATE_WEB_HOOK_RESET', () => {
        const expected  = {
            ...initialState,
            createWebHook: {
                requesting: false,
                success: false,
                error: null
            },
        };
        expect(reducer(initialState,{type:types.CREATE_WEB_HOOK_RESET})).toEqual(expected)
    });

    it('should handle UPDATE_WEB_HOOK_SUCCESS', () => {
        let newData = initialState.webHook.webHooks = [{_id:'_id', integrationType:'webhook', data:{ endpoint: 'http://test.com'}}]
        const payload = [{_id:'_id', integrationType:'webhook',  data:{ endpoint: 'http://tests.com'}}]

        const index = newData.findIndex(hook => hook._id === payload._id);
        newData[index] = payload;
        const count = initialState.webHook.count;

        const expected  = {
            ...initialState,
            webHook: {
                requesting: false,
                error: null,
                success: true,
                webHooks: newData,
                skip: initialState.webHook.skip,
                limit: initialState.webHook.limit,
                count: count
            },
            updateWebHook: {
                requesting: false,
                error: null,
                success: true,
            }
        };
        expect(reducer(initialState,{type: types.UPDATE_WEB_HOOK_SUCCESS, payload:payload})).toEqual(expected)
    });

    it('should handle UPDATE_WEB_HOOK_REQUEST', () => {
        const expected  = {
            ...initialState,
            updateWebHook: {
                requesting: true,
                success: false,
                error: null
            }
        };
        expect(reducer(initialState,{type:types.UPDATE_WEB_HOOK_REQUEST})).toEqual(expected)
    });

    it('should handle UPDATE_WEB_HOOK_FAILED', () => {
        const payload = 'some error'
        const expected  = {
            ...initialState,
            updateWebHook: {
                requesting: false,
                error: payload,
                success: false,
            },
        };
        expect(reducer(initialState,{type:types.UPDATE_WEB_HOOK_FAILED, payload:payload})).toEqual(expected)
    });

    it('should handle UPDATE_WEB_HOOK_RESET', () => {
        const expected  = {
            ...initialState,
            updateWebHook: {
                requesting: false,
                success: false,
                error: null
            },
        };
        expect(reducer(initialState,{type:types.UPDATE_WEB_HOOK_RESET})).toEqual(expected)
    });

    it('should handle PAGINATE_NEXT', () => {
        const expected  = {
            ...initialState,
            pages: {
                counter: 1
            }
        };
        expect(reducer(initialState,{type:types.PAGINATE_NEXT})).toEqual(expected)
    });

    it('should handle PAGINATE_PREV', () => {
        const expected  = {
            ...initialState,
            pages: {
                counter: -1
            }
        };
        expect(reducer(initialState,{type:types.PAGINATE_PREV})).toEqual(expected)
    });

    it('should handle PAGINATE_RESET', () => {
        const expected  = {
            ...initialState,
            pages: {
                counter: 0
            }
        };
        expect(reducer(initialState,{type:types.PAGINATE_RESET})).toEqual(expected)
    });
});