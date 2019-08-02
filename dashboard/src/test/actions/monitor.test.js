import * as _actions from '../../actions/monitor'
import * as _types from '../../constants/monitor'
import axiosMock from '../axios_mock'
import {
    API_URL
} from '../../config'

/*
  Test for Monitor list actions.
*/
const actions = {..._actions,..._types}

describe('actions', () => {
    it('should despatch FETCH_MONITORS_REQUEST and FETCH_MONITORS_SUCCESS  actions', () => {

        axiosMock.onGet(`${API_URL}/monitor/projectId/monitors`).reply(200, [], {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.FETCH_MONITORS_REQUEST:
                    expect(dispatched.type).toEqual(actions.FETCH_MONITORS_REQUEST)
                    break;
                case actions.FETCH_MONITORS_SUCCESS:
                    expect(dispatched.payload).toEqual([])
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.FETCH_MONITORS_SUCCESS)
            }
        }
        let action = actions.fetchMonitors('projectId')(dispatch)
    })
})

describe('actions', () => {
    it('should create an action of type FETCH_MONITORS_SUCCESS, with monitors in payload', () => {
        let monitors = []
        let action = actions.fetchMonitorsSuccess([])

        expect(action.type).toEqual(actions.FETCH_MONITORS_SUCCESS)
        expect(action.payload).toEqual(monitors)
    })
})

describe('actions', () => {
    it('should create an action of type FETCH_MONITORS_REQUEST', () => {
        let action = actions.fetchMonitorsRequest()

        expect(action.type).toEqual(actions.FETCH_MONITORS_REQUEST)
    })
})

describe('actions', () => {
    it('should create an action of type FETCH_MONITORS_FAILURE', () => {
        let error = 'error that occurred'
        let action = actions.fetchMonitorsFailure(error)

        expect(action.type).toEqual(actions.FETCH_MONITORS_FAILURE)
        expect(action.payload).toEqual(error)
    })
})

describe('actions', () => {
    it('should create an action of type FETCH_MONITORS_RESET', () => {
        let error = 'error that occurred'
        let action = actions.resetFetchMonitors(error)

        expect(action.type).toEqual(actions.FETCH_MONITORS_RESET)
    })
})

/*
  Test for Create new monitor actions.
*/
describe('actions', () => {
    it('should create an action of type CREATE_MONITOR_SUCCESS, with new monitor in payload', () => {
        let newMonitor = {}
        let action = actions.createMonitorSuccess(newMonitor)

        expect(action.type).toEqual(actions.CREATE_MONITOR_SUCCESS)
        expect(action.payload).toEqual(newMonitor)
    })
})

describe('actions', () => {
    it('should create an action of type CREATE_MONITOR_REQUEST', () => {
        let action = actions.createMonitorRequest()

        expect(action.type).toEqual(actions.CREATE_MONITOR_REQUEST)
    })
})

describe('actions', () => {
    it('should create an action of type CREATE_MONITOR_FAILURE', () => {
        let error = 'error that occurred'
        let action = actions.createMonitorFailure(error)

        expect(action.type).toEqual(actions.CREATE_MONITOR_FAILURE)
        expect(action.payload).toEqual(error)
    })
})

describe('actions', () => {
    it('should create an action of type CREATE_MONITOR_RESET', () => {
        let action = actions.resetCreateMonitor()

        expect(action.type).toEqual(actions.CREATE_MONITOR_RESET)
    })
})

describe('actions', () => {
    it('should despatch CREATE_MONITOR_REQUEST and CREATE_MONITOR_SUCCESS  actions', () => {

        axiosMock.onPost(`${API_URL}/monitor/projectId/monitor`).reply(200, {
            _id: 'test',
            date: 'February, 17 2018'
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.CREATE_MONITOR_REQUEST:
                    expect(dispatched.type).toEqual(actions.CREATE_MONITOR_REQUEST)
                    break;
                case actions.CREATE_MONITOR_SUCCESS:
                    expect(dispatched.type).toEqual(actions.CREATE_MONITOR_SUCCESS)
                    expect(dispatched.payload).toEqual({
                        _id: 'test',
                        date: 'February, 17 2018'
                    })
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.CREATE_MONITOR_FAILURE)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.createMonitor('projectId', {subProjectId: 'subProjectId'})(dispatch)
    })
})

/*
  Test for Edit new monitor actions.
*/
describe('actions', () => {
    it('should create an action of type EDIT_MONITOR_SUCCESS, with monitor in payload', () => {
        let monitors = [{}]
        let action = actions.editMonitorSuccess([{}])

        expect(action.type).toEqual(actions.EDIT_MONITOR_SUCCESS)
        expect(action.payload).toEqual(monitors)
    })
})

describe('actions', () => {
    it('should create an action of type EDIT_MONITOR_REQUEST', () => {
        let action = actions.editMonitorRequest()

        expect(action.type).toEqual(actions.EDIT_MONITOR_REQUEST)
    })
})

describe('actions', () => {
    it('should create an action of type EDIT_MONITOR_SWITCH', () => {
        let action = actions.editMonitorSwitch(5)

        expect(action.type).toEqual(actions.EDIT_MONITOR_SWITCH)
        expect(action.payload).toEqual(5)
    })
})

describe('actions', () => {
    it('should create an action of type EDIT_MONITOR_FAILURE', () => {
        let error = 'error that occurred'
        let action = actions.editMonitorFailure(error)

        expect(action.type).toEqual(actions.EDIT_MONITOR_FAILURE)
        expect(action.payload).toEqual(error)
    })
})
describe('actions', () => {
    it('should despatch EDIT_MONITOR_REQUEST and EDIT_MONITOR_SUCCESS  actions', () => {

        axiosMock.onPost(`${API_URL}/monitor/projectId/monitor`).reply(200, {
            _id: 'test',
            date: 'February, 17 2018'
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.EDIT_MONITOR_REQUEST:
                    expect(dispatched.type).toEqual(actions.EDIT_MONITOR_REQUEST)
                    break;
                case actions.EDIT_MONITOR_SUCCESS:
                    expect(dispatched.type).toEqual(actions.EDIT_MONITOR_SUCCESS)
                    expect(dispatched.payload).toEqual({
                        _id: 'test',
                        date: 'February, 17 2018'
                    })
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.EDIT_MONITOR_FAILURE)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.editMonitor('projectId', {subProjectId: 'subProjectId'})(dispatch)
    })
})

/*
  Test for Delete monitor actions.
*/

describe('actions', () => {
    it('should create an action of type EDIT_MONITOR_SUCCESS, with removedMonitorId in payload', () => {
        let removedMonitorId = 'id'
        let action = actions.deleteMonitorSuccess(removedMonitorId)

        expect(action.type).toEqual(actions.DELETE_MONITOR_SUCCESS)
        expect(action.payload).toEqual(removedMonitorId)
    })
})

describe('actions', () => {
    it('should create an action of type DELETE_MONITOR_REQUEST', () => {
        let action = actions.deleteMonitorRequest()

        expect(action.type).toEqual(actions.DELETE_MONITOR_REQUEST)
    })
})

describe('actions', () => {
    it('should create an action of type EDIT_MONITOR_SWITCH', () => {
        let action = actions.editMonitorSwitch(5)

        expect(action.type).toEqual(actions.EDIT_MONITOR_SWITCH)
        expect(action.payload).toEqual(5)
    })
})

describe('actions', () => {
    it('should create an action of type DELETE_MONITOR_FAILURE', () => {
        let error = 'error that occurred'
        let action = actions.deleteMonitorFailure(error)

        expect(action.type).toEqual(actions.DELETE_MONITOR_FAILURE)
        expect(action.payload).toEqual(error)
    })
})
describe('actions', () => {
    it('should despatch EDIT_MONITOR_REQUEST and EDIT_MONITOR_SUCCESS  actions', () => {

        axiosMock.onDelete(`${API_URL}/monitor/projectId/monitorId/monitor/delete`).reply(200, {
            _id: 'test',
            date: 'February, 17 2018',
            monitorId:'test'
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.DELETE_MONITOR_REQUEST:
                    expect(dispatched.type).toEqual(actions.DELETE_MONITOR_REQUEST)
                    break;
                case actions.DELETE_MONITOR_SUCCESS:
                    expect(dispatched.type).toEqual(actions.DELETE_MONITOR_SUCCESS)
                    expect(dispatched.payload).toEqual('test')
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.DELETE_MONITOR_FAILURE)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.deleteMonitor('monitorId','projectId', {})(dispatch)
    })
})

/*
  Test for Incidents of monitors actions.
*/
describe('actions', () => {
    it('should create an action of type FETCH_MONITORS_INCIDENT_SUCCESS, with monitors in payload', () => {
        let monitors = [{}]
        let action = actions.fetchMonitorsIncidentsSuccess([{}])

        expect(action.type).toEqual(actions.FETCH_MONITORS_INCIDENT_SUCCESS)
        expect(action.payload).toEqual(monitors)
    })
})

describe('actions', () => {
    it('should create an action of type FETCH_MONITORS_INCIDENT_REQUEST', () => {
        let monitorid = '123456789abcdefghijklmnopqrstuvwxya'
        let action = actions.fetchMonitorsIncidentsRequest(monitorid)

        expect(action.type).toEqual(actions.FETCH_MONITORS_INCIDENT_REQUEST)
        expect(action.payload).toEqual(monitorid)
    })
})

describe('actions', () => {
    it('should create an action of type FETCH_MONITORS_INCIDENT_FAILURE', () => {
        let error = 'error that occurred'
        let action = actions.fetchMonitorsIncidentsFailure(error)

        expect(action.type).toEqual(actions.FETCH_MONITORS_INCIDENT_FAILURE)
        expect(action.payload).toEqual(error)
    })
})

describe('actions', () => {
    it('should despatch EDIT_MONITOR_REQUEST and EDIT_MONITOR_SUCCESS  actions', () => {

        axiosMock.onGet(`${API_URL}/incident/projectId/incidents/monitorId?limit=5&skip=10`).reply(200, [], {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.FETCH_MONITORS_INCIDENT_REQUEST:
                    expect(dispatched.type).toEqual(actions.FETCH_MONITORS_INCIDENT_REQUEST)
                    break;
                case actions.FETCH_MONITORS_INCIDENT_SUCCESS:
                    expect(dispatched.type).toEqual(actions.FETCH_MONITORS_INCIDENT_SUCCESS)
                    expect(dispatched.payload).toEqual({ monitorId: 'monitorId', incidents: [], skip: 10, limit: 5 })
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.FETCH_MONITORS_INCIDENT_FAILURE)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.fetchMonitorsIncidents('projectId', 'monitorId',10,5)(dispatch)
    })
})