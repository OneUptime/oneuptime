
import reducer from '../../reducers/monitor'
import * as types from '../../constants/monitor'

const initialState = {
    monitorsList: {
        monitors: [],
        error: null,
        requesting: false,
        success: false
    },
    newMonitor: {
        monitor: null,
        error: null,
        requesting: false,
        success: false
    },
    editMonitor: {
        error: null,
        requesting: false,
        success: false
    },
    fetchMonitorsIncidentRequest : false,
    deleteMonitor:false,
};


describe('Monitors Reducers',()=>{

    it('should return initial state', () => {
        expect(reducer(initialState,{})).toEqual(initialState)
    });

    it('should handle CREATE_MONITOR_SUCCESS', () => {

        const payload = [{_id:'test CREATE_MONITOR_SUCCESS'}]
        const expected = {
            ...initialState,
            newMonitor: {
                requesting: false,
                error: null,
                success: false,
                monitor: null
            },
            monitorsList: {
                ...initialState.monitorsList,
                monitors: initialState.monitorsList.monitors.concat(payload)
            }
        }
        expect(reducer(initialState,{type:types.CREATE_MONITOR_SUCCESS, payload:payload})).toEqual(expected)

    });

    it('should handle CREATE_MONITOR_FAILURE', () => {

        const payload = 'error CREATE_MONITOR_FAILURE'
        const expected = {
            ...initialState,
            newMonitor: {
                requesting: false,
                error: payload,
                success: false,
                monitor: initialState.newMonitor.monitor
            }
        }
        expect(reducer(initialState,{type:types.CREATE_MONITOR_FAILURE, payload:payload})).toEqual(expected)

    });

    it('should handle CREATE_MONITOR_RESET', () => {

        const payload = 'error CREATE_MONITOR_RESET'
        const expected = {
            ...initialState,
            newMonitor: initialState.newMonitor
        }
        expect(reducer(initialState,{type:types.CREATE_MONITOR_RESET})).toEqual(expected)

    });

    it('should handle CREATE_MONITOR_REQUEST', () => {

        const expected = {
            ...initialState,
            newMonitor: {
                requesting: true,
                error: null,
                success: false,
                monitor: initialState.newMonitor.monitor
            }
        }
        expect(reducer(initialState,{type:types.CREATE_MONITOR_REQUEST})).toEqual(expected)

    });

    it('should handle FETCH_MONITORS_SUCCESS', () => {
        const payload = [{_id:'test CREATE_MONITOR_SUCCESS'}]
        const expected = {
            ...initialState,
            monitorsList: {
                requesting: false,
                error: null,
                success: false,
                monitors: payload
            }
        }
        expect(reducer(initialState,{type:types.FETCH_MONITORS_SUCCESS,payload:payload})).toEqual(expected)

    });

    it('should handle FETCH_MONITORS_FAILURE', () => {
        const payload = 'error FETCH_MONITORS_FAILURE';
        const expected = {
            ...initialState,
            monitorsList: {
                requesting: false,
                error: payload,
                success: false,
                monitors: []
            }
        }
        expect(reducer(initialState,{type:types.FETCH_MONITORS_FAILURE,payload:payload})).toEqual(expected)

    });

    it('should handle FETCH_MONITORS_RESET', () => {
        const expected = {
            ...initialState,
            monitorsList: initialState.monitorsList
        }
        expect(reducer(initialState,{type:types.FETCH_MONITORS_RESET})).toEqual(expected)

    });

    it('should handle FETCH_MONITORS_REQUEST', () => {
        const expected = {
            ...initialState,
            monitorsList: {
                requesting: true,
                error: null,
                success: false,
                monitors: []
            }
        }
        expect(reducer(initialState,{type:types.FETCH_MONITORS_REQUEST})).toEqual(expected)

    });

    it('should handle EDIT_MONITOR_SUCCESS no monitors in state', () => {
        const expected = {
            ...initialState,
            monitorsList: {
                requesting: false,
                error: null,
                success: false,
                monitors: []
            },
            editMonitor: {
                requesting: false,
                error: null,
                success: false
            }
        }
        expect(reducer(initialState,{type:types.EDIT_MONITOR_SUCCESS})).toEqual(expected)

    });

    it('should handle EDIT_MONITOR_SUCCESS with monitors in state, same _id in payload, return monitor in state', () => {
        const payload = {_id:'test_ EDIT_MONITOR_SUCCESS'}
        initialState.monitorsList.monitors = [{_id:'test EDIT_MONITOR_SUCCESS',from:'state'}]
        const expected = {
            ...initialState,
            monitorsList: {
                requesting: false,
                error: null,
                success: false,
                monitors: [{_id:'test EDIT_MONITOR_SUCCESS',from:'state'}]
            },
            editMonitor: {
                requesting: false,
                error: null,
                success: false
            }
        }
        expect(reducer(initialState,{type:types.EDIT_MONITOR_SUCCESS, payload:payload})).toEqual(expected)

    });

    it('should handle EDIT_MONITOR_SUCCESS with monitors in state, different _id, return monitor in payload', () => {
        const payload = {_id:'test EDIT_MONITOR_SUCCESS',from:'payload'}
        initialState.monitorsList.monitors = [{_id:'test EDIT_MONITOR_SUCCESS'}]
        const expected = {
            ...initialState,
            monitorsList: {
                requesting: false,
                error: null,
                success: false,
                monitors: [payload]
            },
            editMonitor: {
                requesting: false,
                error: null,
                success: false
            }
        }
        expect(reducer(initialState,{type:types.EDIT_MONITOR_SUCCESS, payload:payload})).toEqual(expected)

    });

    it('should handle EDIT_MONITOR_FAILURE', () => {
        const expected = {
            ...initialState,
            editMonitor: {
                requesting: false,
                error: 'error EDIT_MONITOR_FAILURE',
                success: false
            }
        }
        expect(reducer(initialState,{type:types.EDIT_MONITOR_FAILURE, payload:'error EDIT_MONITOR_FAILURE'})).toEqual(expected)

    });

    it('should handle EDIT_MONITOR_RESET', () => {
        const expected = {
            ...initialState,
            editMonitor: initialState.editMonitor
        }
        expect(reducer(initialState,{type:types.EDIT_MONITOR_RESET})).toEqual(expected)

    });

    it('should handle EDIT_MONITOR_REQUEST', () => {
        const expected = {
            ...initialState,
            editMonitor: {
                requesting: true,
                error: null,
                success: false
            }
        }
        expect(reducer(initialState,{type:types.EDIT_MONITOR_REQUEST})).toEqual(expected)

    });

    it('should handle EDIT_MONITOR_SWITCH, with [] in state.monitorsList.monitors ', () => {
        initialState.monitorsList.monitors = [];
        const expected = {
            ...initialState,
            monitorsList: {
                requesting:false,
                error:null,
                success: false,
                monitors: []
            },
            editMonitor: {
                requesting:false,
                error:null,
                success: false
            }
        }
        expect(reducer(initialState,{type:types.EDIT_MONITOR_SWITCH})).toEqual(expected)

    });

    it('should handle EDIT_MONITOR_SWITCH, with monitors in state.monitorsList.monitors, payload is this monitor ', () => {
        initialState.monitorsList.monitors = [{editMode:false}];
        const expected = {
            ...initialState,
            monitorsList: {
                requesting:false,
                error:null,
                success: false,
                monitors: [{editMode:true}]
            },
            editMonitor: {
                requesting:false,
                error:null,
                success: false
            }
        }
        expect(reducer(initialState,{type:types.EDIT_MONITOR_SWITCH, payload:0})).toEqual(expected)

    });

    it('should handle EDIT_MONITOR_SWITCH, with monitors in state.monitorsList.monitors, payload is this monitor ', () => {
        initialState.monitorsList.monitors = [{editMode:true}];
        const expected = {
            ...initialState,
            monitorsList: {
                requesting:false,
                error:null,
                success: false,
                monitors: [{editMode:false}]
            },
            editMonitor: {
                requesting:false,
                error:null,
                success: false
            }
        }
        expect(reducer(initialState,{type:types.EDIT_MONITOR_SWITCH, payload:0})).toEqual(expected)

    });

    it('should handle EDIT_MONITOR_SWITCH, with monitors in state.monitorsList.monitors, payload is not this monitor ', () => {
        initialState.monitorsList.monitors = [{editMode:false}];
        const expected = {
            ...initialState,
            monitorsList: {
                requesting:false,
                error:null,
                success: false,
                monitors: [{editMode:false}]
            },
            editMonitor: {
                requesting:false,
                error:null,
                success: false
            }
        }
        expect(reducer(initialState,{type:types.EDIT_MONITOR_SWITCH, payload:1})).toEqual(expected)

    });

    it('should handle FETCH_MONITORS_INCIDENT_SUCCESS, no monitors in state', () => {
        initialState.monitorsList.monitors = []
        const expected = {
            ...initialState,
            monitorsList: {
                requesting: false,
                error: null,
                success: true,
                monitors: []
            },
            fetchMonitorsIncidentRequest : false
        }
        expect(reducer(initialState,{type:types.FETCH_MONITORS_INCIDENT_SUCCESS, payload:{monitorId:'test FETCH_MONITORS_INCIDENT_SUCCESS'}})).toEqual(expected)

    });

    it('should handle FETCH_MONITORS_INCIDENT_SUCCESS, monitors in state, same id as in payload ', () => {
        const payload = [{_id:'test FETCH_MONITORS_INCIDENT_SUCCESS', skip:3,limit:6,incidents:{data: [{_id:'test incidentId'}]}}];
        initialState.monitorsList.monitors = [{_id:'test FETCH_MONITORS_INCIDENT_SUCCESS', skip:3,limit:6,incidents:{data: [{_id:'test incidentId'}]}}]
        const expected = {
            ...initialState,
            monitorsList: {
                requesting: false,
                error: null,
                success: true,
                monitors: [{_id:'test FETCH_MONITORS_INCIDENT_SUCCESS', skip:3,limit:6,incidents:{data: [{_id:'test incidentId'}]}}]
            },
            fetchMonitorsIncidentRequest : false
        }
        expect(reducer(initialState,{
            type:types.FETCH_MONITORS_INCIDENT_SUCCESS,
            payload:payload
        })).toEqual(expected)

    });

    it('should handle FETCH_MONITORS_INCIDENT_SUCCESS, monitors in state, different id as in payload ', () => {
        const payload = {monitorId:'_test FETCH_MONITORS_INCIDENT_SUCCESS', skip:3,limit:6,incidents:[{_id:'test incidentId'}]}
        initialState.monitorsList.monitors = [{_id:'test FETCH_MONITORS_INCIDENT_SUCCESS'}]
        const expected = {
            ...initialState,
            monitorsList: {
                requesting: false,
                error: null,
                success: true,
                monitors: [{_id:'test FETCH_MONITORS_INCIDENT_SUCCESS'}]
            },
            fetchMonitorsIncidentRequest : false
        }
        expect(reducer(initialState,{type:types.FETCH_MONITORS_INCIDENT_SUCCESS, payload:payload})).toEqual(expected)

    });

    it('should handle FETCH_MONITORS_INCIDENT_FAILURE', () => {
        initialState.monitorsList.monitors = [{editMode:false}];
        const expected = {
            ...initialState,
            monitorsList: {
                requesting: false,
                error: 'error FETCH_MONITORS_INCIDENT_FAILURE',
                success: false,
                monitors: []
            },
            fetchMonitorsIncidentRequest : false
        }
        expect(reducer(initialState,{type:types.FETCH_MONITORS_INCIDENT_FAILURE, payload:'error FETCH_MONITORS_INCIDENT_FAILURE'})).toEqual(expected)

    });

    it('should handle FETCH_MONITORS_INCIDENT_REQUEST', () => {
        const payload = {data:{test:'test FETCH_MONITORS_INCIDENT_REQUEST'}}
        const expected = {
            ...initialState,
            fetchMonitorsIncidentRequest : payload
        }
        expect(reducer(initialState,{type:types.FETCH_MONITORS_INCIDENT_REQUEST, payload:payload})).toEqual(expected)

    });

    it('should handle DELETE_MONITOR_SUCCESS, different _id in payload', () => {
        initialState.monitorsList.monitors =[ {_id:'_test DELETE_MONITOR_SUCCESS'}];
        const payload = 'test DELETE_MONITOR_SUCCESS'
        const expected = {
            ...initialState,
            monitorsList: {
                requesting: false,
                error: null,
                success: false,
                monitors: [{_id:'_test DELETE_MONITOR_SUCCESS'}]
            },
            deleteMonitor : false,
        }
        expect(reducer(initialState,{type:types.DELETE_MONITOR_SUCCESS, payload:payload})).toEqual(expected)

    });

    it('should handle DELETE_MONITOR_SUCCESS, same _id in payload', () => {
        initialState.monitorsList.monitors = [{_id:'test DELETE_MONITOR_SUCCESS'}]
        const payload = 'test DELETE_MONITOR_SUCCESS'
        const expected = {
            ...initialState,
            monitorsList: {
                requesting: false,
                error: null,
                success: false,
                monitors: []
            },
            deleteMonitor : false,
        }
        expect(reducer(initialState,{type:types.DELETE_MONITOR_SUCCESS, payload:payload})).toEqual(expected)

    });

    it('should handle DELETE_MONITOR_FAILURE', () => {
        const payload = 'error DELETE_MONITOR_FAILURE'
        const expected = {
            ...initialState,
            monitorsList: {
                requesting: false,
                error: payload,
                success: false,
                monitors: [{_id:'test DELETE_MONITOR_SUCCESS'}]
            },
            deleteMonitor : false,
        }
        expect(reducer(initialState,{type:types.DELETE_MONITOR_FAILURE, payload:payload})).toEqual(expected)

    });

    it('should handle DELETE_MONITOR_REQUEST', () => {
        const payload = 'error DELETE_MONITOR_REQUEST'
        const expected = {
            ...initialState,
            monitorsList: {
                requesting: false,
                error: null,
                success: false,
                monitors: [...initialState.monitorsList.monitors]
            },
            deleteMonitor : payload,
        }
        expect(reducer(initialState,{type:types.DELETE_MONITOR_REQUEST, payload:payload})).toEqual(expected)

    });

    it('should handle DELETE_PROJECT_MONITORS', () => {
        const payload = 'test_ DELETE_PROJECT_MONITORS'
        initialState.monitorsList.monitors = [{projectId:'test DELETE_PROJECT_MONITORS'}]
        const expected = {
            ...initialState,
            monitorsList: {
                monitors: [{projectId:'test DELETE_PROJECT_MONITORS'}],
                error: null,
                loading: false
            }
        }
        expect(reducer(initialState,{type:types.DELETE_PROJECT_MONITORS, payload:payload})).toEqual(expected)

    });

    it('should handle DELETE_PROJECT_MONITORS, with filter to []', () => {
        const payload = 'test DELETE_PROJECT_MONITORS'
        initialState.monitorsList.monitors = [{projectId:'test DELETE_PROJECT_MONITORS'}]
        const expected = {
            ...initialState,
            monitorsList: {
                monitors: [],
                error: null,
                loading: false
            }
        }
        expect(reducer(initialState,{type:types.DELETE_PROJECT_MONITORS, payload:payload})).toEqual(expected)

    });

    it('should handle INCIDENT_RESOLVED_BY_SOCKET,return incident in payload', () => {
        const payload = {data:{_id:'test INCIDENT_RESOLVED_BY_SOCKET',from:'payload'}}

        initialState.monitorsList.monitors = [{_id:'test INCIDENT_RESOLVED_BY_SOCKET',incidents:[{_id:'test INCIDENT_RESOLVED_BY_SOCKET',from:'state'}]}]

        const expected = {
            ...initialState,
            monitorsList: {
                requesting: false,
                error: null,
                success: true,
                monitors: [{_id:'test INCIDENT_RESOLVED_BY_SOCKET',incidents:[{_id:'test INCIDENT_RESOLVED_BY_SOCKET',from:'payload'}]}]
            }
        }
        expect(reducer(initialState,{type:'INCIDENT_RESOLVED_BY_SOCKET', payload:payload})).toEqual(expected)

    });

    it('should handle INCIDENT_RESOLVED_BY_SOCKET,return incident in state', () => {
        const payload = {data:{_id:'_test INCIDENT_RESOLVED_BY_SOCKET',from:'payload'}}
        initialState.monitorsList.monitors = [{_id:'test INCIDENT_RESOLVED_BY_SOCKET',incidents:[{_id:'test INCIDENT_RESOLVED_BY_SOCKET',from:'state'}]}]

        const expected = {
            ...initialState,
            monitorsList: {
                requesting: false,
                error: null,
                success: true,
                monitors: [{_id:'test INCIDENT_RESOLVED_BY_SOCKET',incidents:[{_id:'test INCIDENT_RESOLVED_BY_SOCKET',from:'state'}]}]
            }
        }
        expect(reducer(initialState,{type:'INCIDENT_RESOLVED_BY_SOCKET', payload:payload})).toEqual(expected)

    });

    it('should handle INCIDENT_ACKNOWLEDGED_BY_SOCKET,return incident in state', () => {
        const payload = {data:{_id:'_test INCIDENT_ACKNOWLEDGED_BY_SOCKET',from:'payload'}}
        initialState.monitorsList.monitors = [{_id:'test INCIDENT_ACKNOWLEDGED_BY_SOCKET',incidents:[{_id:'test INCIDENT_ACKNOWLEDGED_BY_SOCKET',from:'state'}]}]

        const expected = {
            ...initialState,
            monitorsList: {
                requesting: false,
                error: null,
                success: true,
                monitors: [{_id:'test INCIDENT_ACKNOWLEDGED_BY_SOCKET',incidents:[{_id:'test INCIDENT_ACKNOWLEDGED_BY_SOCKET',from:'state'}]}]
            }
        }
        expect(reducer(initialState,{type:'INCIDENT_ACKNOWLEDGED_BY_SOCKET', payload:payload})).toEqual(expected)

    });
    it('should handle INCIDENT_ACKNOWLEDGED_BY_SOCKET,return incident in payload', () => {
        const payload = {data:{_id:'test INCIDENT_ACKNOWLEDGED_BY_SOCKET',from:'payload'}}
        initialState.monitorsList.monitors = [{_id:'test INCIDENT_ACKNOWLEDGED_BY_SOCKET',incidents:[{_id:'test INCIDENT_ACKNOWLEDGED_BY_SOCKET',from:'state'}]}]

        const expected = {
            ...initialState,
            monitorsList: {
                requesting: false,
                error: null,
                success: true,
                monitors: [{_id:'test INCIDENT_ACKNOWLEDGED_BY_SOCKET',incidents:[{_id:'test INCIDENT_ACKNOWLEDGED_BY_SOCKET',from:'payload'}]}]
            }
        }
        expect(reducer(initialState,{type:'INCIDENT_ACKNOWLEDGED_BY_SOCKET', payload:payload})).toEqual(expected)

    });


    it('should handle DELETE_MONITOR_BY_SOCKET,return one monitor', () => {
        const payload = '_test DELETE_MONITOR_BY_SOCKET'
        initialState.monitorsList.monitors = [{_id:'test DELETE_MONITOR_BY_SOCKET'}]

        const expected = {
            ...initialState,
            monitorsList: {
                requesting: false,
                error: null,
                success: false,
                monitors: [{_id:'test DELETE_MONITOR_BY_SOCKET'}]
            }
        }
        expect(reducer(initialState,{type:'DELETE_MONITOR_BY_SOCKET', payload:payload})).toEqual(expected)

    });

    it('should handle DELETE_MONITOR_BY_SOCKET,filter monitors to []', () => {
        const payload = 'test DELETE_MONITOR_BY_SOCKET'

        initialState.monitorsList.monitors = [{_id:'test DELETE_MONITOR_BY_SOCKET'}]

        const expected = {
            ...initialState,
            monitorsList: {
                requesting: false,
                error: null,
                success: false,
                monitors: []
            }
        }
        expect(reducer(initialState,{type:'DELETE_MONITOR_BY_SOCKET', payload:payload})).toEqual(expected)

    });

    it('should handle ADD_NEW_INCIDENT_TO_MONITORS,filter monitors to []', () => {
        const payload = {monitorId:{_id:'test ADD_NEW_INCIDENT_TO_MONITORS'},_id:'test1 ADD_NEW_INCIDENT_TO_MONITORS'}

        initialState.monitorsList.monitors = [{_id:'test ADD_NEW_INCIDENT_TO_MONITORS',incidents:[{_id:'test1 ADD_NEW_INCIDENT_TO_MONITORS',monitorId:{_id:'test ADD_NEW_INCIDENT_TO_MONITORS'}},{_id:'test2 ADD_NEW_INCIDENT_TO_MONITORS',monitorId:{_id:'test ADD_NEW_INCIDENT_TO_MONITORS'}}]}]

        const expected = {
            ...initialState,
            monitorsList: {
                ...initialState.monitorsList,
                monitors:  [{_id:'test ADD_NEW_INCIDENT_TO_MONITORS',incidents:[{_id:'test1 ADD_NEW_INCIDENT_TO_MONITORS',monitorId:{_id:'test ADD_NEW_INCIDENT_TO_MONITORS'}},{_id:'test1 ADD_NEW_INCIDENT_TO_MONITORS',monitorId:{_id:'test ADD_NEW_INCIDENT_TO_MONITORS'}},{_id:'test2 ADD_NEW_INCIDENT_TO_MONITORS',monitorId:{_id:'test ADD_NEW_INCIDENT_TO_MONITORS'}}]}],
            },
        }
        expect(reducer(initialState,{type:'ADD_NEW_INCIDENT_TO_MONITORS', payload:payload})).toEqual(expected)

    });

    it('should handle UPDATE_RESPONSE_TIME,filter monitors to []', () => {
        const payload = {monitorId:'test UPDATE_RESPONSE_TIME',_id:'test UPDATE_RESPONSE_TIME',time:'some date',status:'some status'}

        initialState.monitorsList.monitors = [{_id:'test UPDATE_RESPONSE_TIME',monitorId:'test UPDATE_RESPONSE_TIME'}]

        const expected = {
            ...initialState,
            monitorsList: {
                ...initialState.monitorsList,
                monitors:  [{_id:'test UPDATE_RESPONSE_TIME',monitorId:'test UPDATE_RESPONSE_TIME',responseTime:'some date',status:'some status'}]
            },
        }
        expect(reducer(initialState,{type:'UPDATE_RESPONSE_TIME', payload:payload})).toEqual(expected)

    });

    it('should handle UPDATE_RESPONSE_TIME,filter monitors to []', () => {
        const payload = {monitorId:'_test UPDATE_RESPONSE_TIME',_id:'test UPDATE_RESPONSE_TIME',time:'some date',status:'some status'}

        initialState.monitorsList.monitors = [{_id:'test UPDATE_RESPONSE_TIME',monitorId:'test UPDATE_RESPONSE_TIME'}]

        const expected = {
            ...initialState,
            monitorsList: {
                ...initialState.monitorsList,
                monitors:  [{_id:'test UPDATE_RESPONSE_TIME',monitorId:'test UPDATE_RESPONSE_TIME',}]
            },
        }
        expect(reducer(initialState,{type:'UPDATE_RESPONSE_TIME', payload:payload})).toEqual(expected)

    });


});
