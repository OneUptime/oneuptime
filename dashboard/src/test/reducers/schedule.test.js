
import reducer from '../../reducers/schedule'
import * as types from '../../constants/schedule'

const initialState = {
    schedules: {
        requesting: false,
        error: null,
        success: false,
        data: [],
        count: null,
        limit: null,
        skip: null
    },
    newSchedule: {
        success: false,
        requesting: false,
        error: null
    },
    renameSchedule: {
        success: false,
        requesting: false,
        error: null
    },
    deleteSchedule: {
        success: false,
        requesting: false,
        error: null
    },
    addMonitor: {
        success: false,
        requesting: false,
        error: null
    },
    addUser: {
        success: false,
        requesting: false,
        error: null
    },
    pages: {
		counter: 1
    },
    subProjectSchedules:[]
};


describe('Schedules Reducers',()=>{

    it('should return initial state', () => {
        expect(reducer(initialState,{})).toEqual(initialState)
    });

    it('should handle SCHEDULE_FETCH_SUCCESS', () => {
        const payload = { data: [{_id:'_id'}], count: 1, skip: 0, limit: 10};
        const expected  = {
            ...initialState,
            schedules: {
                requesting: false,
                error: null,
                success: true,
                data: payload.data,
                count: payload.count,
                limit: payload.limit,
                skip: payload.skip
            },
        };        
        expect(reducer(initialState,{type:types.SCHEDULE_FETCH_SUCCESS,payload:payload})).toEqual(expected)
    });

    it('should handle SCHEDULE_FETCH_REQUEST', () => {
        initialState.schedules.data = [{_id:'_id'}]
        const expected  = {
            ...initialState,
            schedules: {
                requesting: true,
                success: false,
                error: null,
                data: initialState.schedules.data,
                count: initialState.schedules.count,
                limit: initialState.schedules.limit,
                skip: initialState.schedules.skip
            }
        };        
        expect(reducer(initialState,{type:types.SCHEDULE_FETCH_REQUEST})).toEqual(expected)
    });

    it('should handle SCHEDULE_FETCH_FAILED', () => {
        const payload = 'some error'
        const expected  = {
            ...initialState,
            schedules: {
                requesting: false,
                error: payload,
                success: false,
                data: [],
                count: null,
                limit: null,
                skip: null
            },
        };        
        expect(reducer(initialState,{type:types.SCHEDULE_FETCH_FAILED,payload:payload})).toEqual(expected)
    });

    it('should handle SCHEDULE_FETCH_RESET', () => {
        const payload = 'some error'
        const expected  = {
            ...initialState,
            schedules: {
                requesting: false,
                error: null,
                success: false,
                data: [],
                count: null,
                limit: null,
                skip: null
            },
        };        
        expect(reducer(initialState,{type:types.SCHEDULE_FETCH_RESET})).toEqual(expected)
    });

    it('should handle SCHEDULE_FETCH_SUCCESS', () => {
        initialState.schedules.data = [{_id:'_id',name:'Enter Schedule Name'}]
        const payload = { data: [{_id:'_id'}], count: 1, skip: 0, limit: 10};
        const expected  = {
            ...initialState,
            schedules: {
                requesting: false,
                error: null,
                success: true,
                data: payload,
                data: payload.data,
                count: payload.count,
                limit: payload.limit,
                skip: payload.skip
            },
        };        
        expect(reducer(initialState,{type:types.SCHEDULE_FETCH_SUCCESS,payload:payload})).toEqual(expected)
    });

    it('should handle CREATE_SCHEDULE_REQUEST', () => {
        const expected  = {
            ...initialState,
            newSchedule: {
                requesting: true,
                success: false,
                error: null
            }
        };        
        expect(reducer(initialState,{type:types.CREATE_SCHEDULE_REQUEST})).toEqual(expected)
    });

    it('should handle CREATE_SCHEDULE_SUCCESS', () => {
        initialState.schedules.data = [{_id:'_id',name:'Enter Schedule Name'}]
        const payload = [{_id:'_id'}]
        const expected  = {
            ...initialState,
            schedules: {
                requesting: false,
                error: null,
                success: true,
                data: [{_id:'_id',name:'Enter Schedule Name'}],
                count: NaN
            },
        };        
        expect(reducer(initialState,{type:types.CREATE_SCHEDULE_SUCCESS,payload:payload})).toEqual(expected)
    });

    it('should handle CREATE_SCHEDULE_SUCCESS', () => {
        initialState.schedules.data = [{_id:'_id',name:'Not Enter Schedule Name'}]
        const payload = [{_id:'_id',from:'payload'}]
        const expected  = {
            ...initialState,
            schedules: {
                requesting: false,
                error: null,
                success: true,
                data: [{_id:'_id',name:'Not Enter Schedule Name'},{_id:'_id',from:'payload'}],
                count: NaN
            },
        };     
        const received = reducer(initialState,{type:types.CREATE_SCHEDULE_SUCCESS,payload:payload})   
        expect(JSON.stringify(received)).toEqual(JSON.stringify(expected))
    });

    it('should handle CREATE_SCHEDULE_FAILED', () => {
        const payload = 'some error'
        const expected  = {
            ...initialState,
            newSchedule: {
                requesting: false,
                error: payload,
                success: false,
            },
        };        
        expect(reducer(initialState,{type:types.CREATE_SCHEDULE_FAILED,payload:payload})).toEqual(expected)
    });

    it('should handle CREATE_SCHEDULE_RESET', () => {
        const expected  = {
            ...initialState,
            newSchedule: {
                requesting: false,
                success: false,
                error: null
            },
        };        
        expect(reducer(initialState,{type:types.CREATE_SCHEDULE_RESET})).toEqual(expected)
    });

    it('should handle RENAME_SCHEDULE_SUCCESS', () => {
        initialState.schedules.data = [{_id:'_id',name:'Enter Schedule Name'}]
        const payload = [{_id:'_id'}]
        const expected  = {
            ...initialState,
            renameSchedule: {
                requesting: false,
                success: true,
                error: null
            },
            schedules: {
                requesting: false,
                error: null,
                success: true,
                data:initialState.schedules.data
            },
        };
        let received =  reducer(initialState,{type:types.RENAME_SCHEDULE_SUCCESS,payload:payload})       
        expect(JSON.stringify(received)).toEqual(JSON.stringify(expected))
    });

    it('should handle RENAME_SCHEDULE_REQUEST', () => {
        const expected  = {
            ...initialState,
            renameSchedule: {
                requesting: true,
                success: false,
                error: null
            },
        };        
        expect(reducer(initialState,{type:types.RENAME_SCHEDULE_REQUEST})).toEqual(expected)
    });

    it('should handle RENAME_SCHEDULE_FAILED', () => {
        const payload = 'some error'
        const expected  = {
            ...initialState,
            renameSchedule: {
                requesting: false,
                success: false,
                error: payload,
            }
        };        
        expect(reducer(initialState,{type:types.RENAME_SCHEDULE_FAILED,payload:payload})).toEqual(expected)
    });

    it('should handle RENAME_SCHEDULE_RESET', () => {
        const expected  = {
            ...initialState,
            renameSchedule: {
                requesting: false,
                success: false,
                error: null,
            }
        };        
        expect(reducer(initialState,{type:types.RENAME_SCHEDULE_RESET})).toEqual(expected)
    });

    it('should handle DELETE_SCHEDULE_SUCCESS not deleted', () => {
        const payload = {ok:0,n:3,scheduleId:'test DELETE_SCHEDULE_SUCCESS'}
        const expected  = {
            ...initialState,
            deleteSchedule: {
                requesting: false,
                success: true,
                error: null
            },
            schedules: {
                requesting: false,
                error: null,
                success: true,
                data:initialState.schedules.data
            },
        };        
        expect(reducer(initialState,{type:types.DELETE_SCHEDULE_SUCCESS,payload:payload})).toEqual(expected)
    });

    it('should handle DELETE_SCHEDULE_SUCCESS, deleted', () => {
        const payload = {ok:1,n:1,scheduleId:'_id'}
        initialState.schedules.data = [{_id:'_id'}]
        const expected  = {
            ...initialState,
            deleteSchedule: {
                requesting: false,
                success: true,
                error: null
            },
            schedules: {
                requesting: false,
                error: null,
                success: true,
                data:[]
            },
        };        
        expect(reducer(initialState,{type:types.DELETE_SCHEDULE_SUCCESS,payload:payload})).toEqual(expected)
    });

    it('should handle DELETE_SCHEDULE_RESET', () => {
        const expected  = {
            ...initialState,
            deleteSchedule: {
                requesting: false,
                success: false,
                error: null,
            }
        };        
        expect(reducer(initialState,{type:types.DELETE_SCHEDULE_RESET})).toEqual(expected)
    });

    it('should handle DELETE_SCHEDULE_FAILED', () => {
        const payload = 'some error'
        const expected  = {
            ...initialState,
            deleteSchedule: {
                requesting: false,
                success: false,
                error: payload,
            }
        };        
        expect(reducer(initialState,{type:types.DELETE_SCHEDULE_FAILED,payload:payload})).toEqual(expected)
    });

    it('should handle DELETE_SCHEDULE_REQUEST', () => {
        const expected  = {
            ...initialState,
            deleteSchedule: {
                requesting: true,
                success: false,
                error: null
            }
        };        
        expect(reducer(initialState,{type:types.DELETE_SCHEDULE_REQUEST})).toEqual(expected)
    });

    it('should handle DELETE_PROJECT_SCHEDULES, same _id in payload', () => {
        const payload = '_id'
        initialState.schedules.data = [{_id:'_id',projectId:'_id'}]
        const expected  = {
            ...initialState,
            schedules: {
                requesting: false,
                error: null,
                success: true,
                data: []
            }
        };        
        expect(reducer(initialState,{type:types.DELETE_PROJECT_SCHEDULES,payload:payload})).toEqual(expected)
    });


    it('should handle DELETE_PROJECT_SCHEDULES, diff _id in payload', () => {
        const payload = '_id'
        initialState.schedules.data = [{_id:'_id',projectId:'__id'}]
        const expected  = {
            ...initialState,
            schedules: {
                requesting: false,
                error: null,
                success: true,
                data:[{_id:'_id',projectId:'__id'}]
            }
        };        
        expect(reducer(initialState,{type:types.DELETE_PROJECT_SCHEDULES,payload:payload})).toEqual(expected)
    });

    it('should handle ADD_MONITOR_SUCCESS, diff _id in payload', () => {
        const payload = [{_id: '_id'}]
        initialState.schedules.data = [{_id:'_id',projectId:'_id'}]
        const expected  = {
            ...initialState,
            addMonitor: {
                requesting: false,
                success: true,
                error: null
            },
            schedules: {
                requesting: false,
                error: null,
                success: false,
                data: [{_id:'_id'}]
            },
        };        
        expect(reducer(initialState,{type:types.ADD_MONITOR_SUCCESS,payload:payload})).toEqual(expected)
    });

    it('should handle ADD_MONITOR_SUCCESS, diff _id in payload', () => {
        const payload = [{_id: '__id'}]
        initialState.schedules.data = [{_id:'_id',projectId:'_id'}]
        const expected  = {
            ...initialState,
            addMonitor: {
                requesting: false,
                success: true,
                error: null
            },
            schedules: {
                requesting: false,
                error: null,
                success: false,
                data: [{_id:'_id',projectId:'_id'}]
            },
        }; 
        const received = reducer(initialState,{type:types.ADD_MONITOR_SUCCESS,payload:payload})       
        expect(JSON.stringify(received)).toEqual(JSON.stringify(expected))
    });

    it('should handle ADD_MONITOR_REQUEST', () => {
        const expected  = {
            ...initialState,
            addMonitor: {
                requesting: true,
                success: false,
                error: null
            }
        };        
        expect(reducer(initialState,{type:types.ADD_MONITOR_REQUEST})).toEqual(expected)
    });

    it('should handle ADD_MONITOR_RESET', () => {
        const expected  = {
            ...initialState,
            addMonitor: {
                requesting: false,
                success: false,
                error: null,
            }
        };        
        expect(reducer(initialState,{type:types.ADD_MONITOR_RESET})).toEqual(expected)
    });


    it('should handle ADD_MONITOR_FAILED', () => {
        const payload = 'some error'
        const expected  = {
            ...initialState,
            addMonitor: {
                requesting: false,
                success: false,
                error: payload,
            }
        };        
        expect(reducer(initialState,{type:types.ADD_MONITOR_FAILED,payload:payload})).toEqual(expected)
    });

    it('should handle ADD_USER_SUCCESS, diff _id in payload', () => {
        const payload = {_id: '_id'}
        initialState.schedules.data = [{_id:'_id',projectId:'_id'}]
        const expected  = {
            ...initialState,
            addUser: {
                requesting: false,
                success: true,
                error: null
            },
            schedules: {
                requesting: false,
                error: null,
                success: false,
                data: [{_id:'_id'}]
            },
        }; 
        const received = reducer(initialState,{type:types.ADD_USER_SUCCESS,payload:payload})       
        expect(reducer(initialState,{type:types.ADD_USER_SUCCESS,payload:payload})).toEqual(expected)
    });

    it('should handle ADD_USER_SUCCESS, diff _id in payload', () => {
        const payload = {_id: '__id'}
        initialState.schedules.data = [{_id:'_id',projectId:'_id'}]
        const expected  = {
            ...initialState,
            addUser: {
                requesting: false,
                success: true,
                error: null
            },
            schedules: {
                requesting: false,
                error: null,
                success: false,
                data: [{_id:'_id',projectId:'_id'}]
            },
        }; 
        const received = reducer(initialState,{type:types.ADD_USER_SUCCESS,payload:payload})       
        expect(JSON.stringify(received)).toEqual(JSON.stringify(expected))
    });

    it('should handle ADD_USER_REQUEST', () => {
        const expected  = {
            ...initialState,
            addUser: {
                requesting: true,
                success: false,
                error: null
            }
        };        
        expect(reducer(initialState,{type:types.ADD_USER_REQUEST})).toEqual(expected)
    });

    it('should handle ADD_USER_RESET', () => {
        const expected  = {
            ...initialState,
            addUser: {
                requesting: false,
                success: false,
                error: null,
            }
        };        
        expect(reducer(initialState,{type:types.ADD_USER_RESET})).toEqual(expected)
    });


    it('should handle ADD_USER_FAILED', () => {
        const payload = 'some error'
        const expected  = {
            ...initialState,
            addUser: {
                requesting: false,
                success: false,
                error: payload,
            }
        };        
        expect(reducer(initialState,{type:types.ADD_USER_FAILED,payload:payload})).toEqual(expected)
    });

    it('should handle PAGINATE_NEXT', () => {
        const expected  = {
            ...initialState,
            pages: {
                counter: 2
            }
        };        
        expect(reducer(initialState,{type:types.PAGINATE_NEXT})).toEqual(expected)
    });

    it('should handle PAGINATE_PREV', () => {
        const expected  = {
            ...initialState,
            pages: {
                counter: 0
            }
        };        
        expect(reducer(initialState,{type:types.PAGINATE_PREV})).toEqual(expected)
    });

    it('should handle PAGINATE_RESET', () => {
        const expected  = {
            ...initialState,
            pages: {
                counter: 1
            }
        };        
        expect(reducer(initialState,{type:types.PAGINATE_RESET})).toEqual(expected)
    });
});
