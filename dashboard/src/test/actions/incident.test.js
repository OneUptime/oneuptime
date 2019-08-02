import * as _actions from '../../actions/incident'
import * as _types from '../../constants/incident'
import axiosMock from '../axios_mock'
import {
    API_URL
} from '../../config'

/*
  Test for Array of Incidents actions.
*/
const actions = {
    ..._actions,
    ..._types
}
describe('actions', () => {
    it('should create an action of type INCIDENTS_REQUEST, promise in payload', () => {
        let promise = Promise.resolve('incident request response')
        let action = actions.incidentsRequest(promise)

        expect(action.type).toEqual(actions.INCIDENTS_REQUEST)
        return action.payload.then(o => {
            expect(o).toEqual('incident request response')
        })
    })
})

describe('actions', () => {
    it('should create an action of type INCIDENTS_FAILED', () => {
        const expectedAction = {
            type: actions.INCIDENTS_FAILED,
            payload: 'error that occurred'
        }
        let action = actions.incidentsError('error that occurred')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions', () => {
    it('should create an action of type INCIDENTS_SUCCESS with incidents in payload', () => {
        const expectedAction = {
            type: actions.INCIDENTS_SUCCESS,
            payload: 'incidents'
        }
        let action = actions.incidentsSuccess('incidents')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions', () => {
    it('should create an action of type INCIDENTS_RESET', () => {
        const expectedAction = {
            type: actions.INCIDENTS_RESET,
        }
        expect(actions.resetIncidents().type).toEqual(expectedAction.type)
    })
})

describe('actions', () => {
    it('should despatch INCIDENTS_REQUEST and INCIDENTS_SUCCESS  actions', () => {

        axiosMock.onGet(`${API_URL}/incident/projectId/incidents?skip=5&limit=10`).reply(200, [], {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.INCIDENTS_REQUEST:
                    expect(dispatched.type).toEqual(actions.INCIDENTS_REQUEST)
                    break;
                case actions.INCIDENTS_SUCCESS:
                    expect(dispatched.type).toEqual(actions.INCIDENTS_SUCCESS)
                    expect(dispatched.payload).toEqual([])
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.INCIDENTS_FAILED)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.getIncidents('projectId', 5, 10)(dispatch)
    })
})

/*
  Test for Create a new incident actions.
*/
describe('actions', () => {
    it('should create an action of type CREATE_INCIDENT_REQUEST, promise in payload', () => {

        let promise = Promise.resolve('create incident request response')
        let action = actions.createIncidentRequest(promise)

        expect(action.type).toEqual(actions.CREATE_INCIDENT_REQUEST)
        return action.payload.then(o => {
            expect(o).toEqual('create incident request response')
        })
    })
})

describe('actions', () => {
    it('should create an action of type CREATE_INCIDENT_FAILED, error in payload', () => {
        const expectedAction = {
            type: actions.CREATE_INCIDENT_FAILED,
            payload: 'error that occurred'
        }
        let action = actions.createIncidentError('error that occurred')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions', () => {
    it('should create an action of type CREATE_INCIDENT_SUCCESS with incidents in payload', () => {
        const expectedAction = {
            type: actions.CREATE_INCIDENT_SUCCESS,
            payload: 'incident'
        }
        let action = actions.createIncidentSuccess('incident')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions', () => {
    it('should create an action of type CREATE_INCIDENT_RESET', () => {
        const expectedAction = {
            type: actions.CREATE_INCIDENT_RESET,
        }
        expect(actions.resetCreateIncident().type).toEqual(expectedAction.type)
    })
})

describe('actions', () => {
    it('should despatch CREATE_INCIDENT_REQUEST and CREATE_INCIDENT_SUCCESS  actions', () => {

        axiosMock.onPost(`${API_URL}/incident/projectId/create`).reply(200, {
            _id: 'id here',
            date: 'February 14th, 3:25:50.125 PM',
            createdBy: {
                _id: 'id here'
            },
            monitorId: {
                _id: 'id here'
            }
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.CREATE_INCIDENT_REQUEST:
                    expect(dispatched.type).toEqual(actions.CREATE_INCIDENT_REQUEST)
                    break;
                case actions.CREATE_INCIDENT_SUCCESS:
                    expect(dispatched.type).toEqual(actions.CREATE_INCIDENT_SUCCESS)
                    expect(dispatched.payload).toEqual({
                        _id: 'id here',
                        date: 'February 14th, 3:25:50.125 PM',
                        createdBy: {
                            _id: 'id here'
                        },
                        monitorId: {
                            _id: 'id here'
                        }
                    })
                    break;
                case 'ADD_NEW_INCIDENT_TO_UNRESOLVED':
                    expect(dispatched.payload).toEqual([{
                        _id: 'id here',
                        date: 'February 14th, 3:25:50.125 PM',
                        createdBy: {
                            _id: 'id here'
                        },
                        monitorId: {
                            _id: 'id here'
                        }
                    }])
                    break;
                case 'ADD_NEW_INCIDENT_TO_MONITORS':
                    expect(dispatched.payload).toEqual({ "_id": "id here", "createdBy": "id here", "date": "February 14th, 3:25:50.125 PM", "monitorId": "id here" })
                    break;

                default:
                    expect(dispatched.type).toEqual(actions.CREATE_INCIDENT_FAILED)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.createNewIncident('projectId', 'monitorId')(dispatch)
    })
})

/*
  Test for incident portion actions.
*/
describe('actions', () => {
    it('should create an action of type INCIDENT_REQUEST, promise in payload', () => {

        let promise = Promise.resolve('incident request response')
        let action = actions.incidentRequest(promise)

        expect(action.type).toEqual(actions.INCIDENT_REQUEST)
        return action.payload.then(o => {
            expect(o).toEqual('incident request response')
        })
    })
})

describe('actions', () => {
    it('should create an action of type INCIDENT_FAILED, error in payload', () => {
        const expectedAction = {
            type: actions.INCIDENT_FAILED,
            payload: 'error that occurred'
        }
        let action = actions.incidentError('error that occurred')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions', () => {
    it('should create an action of type INCIDENT_SUCCESS with incident in payload', () => {
        const expectedAction = {
            type: actions.INCIDENT_SUCCESS,
            payload: 'incident'
        }
        let action = actions.incidentSuccess('incident')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions', () => {
    it('should create an action of type INCIDENT_RESET', () => {
        const expectedAction = {
            type: actions.INCIDENT_RESET,
        }
        expect(actions.resetIncident().type).toEqual(expectedAction.type)
    })
})

describe('actions', () => {
    it('should create an action of type ACKNOWLEDGE_INCIDENT_REQUEST, promise in payload', () => {

        let promise = Promise.resolve('Acknowledge Incident Request request response')
        let action = actions.acknowledgeIncidentRequest(promise)

        expect(action.type).toEqual(actions.ACKNOWLEDGE_INCIDENT_REQUEST)
        return action.payload.then(o => {
            expect(o).toEqual('Acknowledge Incident Request request response')
        })
    })
})

describe('actions', () => {
    it('should create an action of type RESOLVE_INCIDENT_REQUEST, promise in payload', () => {

        let promise = Promise.resolve('Resolve Incident Request request response')
        let action = actions.resolveIncidentRequest(promise)

        expect(action.type).toEqual(actions.RESOLVE_INCIDENT_REQUEST)
        return action.payload.then(o => {
            expect(o).toEqual('Resolve Incident Request request response')
        })
    })
})

describe('actions', () => {
    it('should create an action of type ACKNOWLEDGE_INCIDENT_SUCCESS with incident in payload', () => {
        const expectedAction = {
            type: actions.ACKNOWLEDGE_INCIDENT_SUCCESS,
            payload: 'incident'
        }
        let action = actions.acknowledgeIncidentSuccess('incident')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions', () => {
    it('should create an action of type RESOLVE_INCIDENT_SUCCESS with incident in payload', () => {
        const expectedAction = {
            type: actions.RESOLVE_INCIDENT_SUCCESS,
            payload: 'incident'
        }
        let action = actions.resolveIncidentSuccess('incident')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})


describe('actions', () => {
    it('should despatch INCIDENT_REQUEST and INCIDENT_SUCCESS  actions', () => {

        axiosMock.onGet(`${API_URL}/incident/projectId/incident/incidentId`).reply(200, {
            _id: 'id here',
            date: 'February 14th, 3:25:50.125 PM'
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.INCIDENT_REQUEST:
                    expect(dispatched.type).toEqual(actions.INCIDENT_REQUEST)
                    break;
                case actions.INCIDENT_SUCCESS:
                    expect(dispatched.type).toEqual(actions.INCIDENT_SUCCESS)
                    expect(dispatched.payload).toEqual({
                        _id: 'id here',
                        date: 'February 14th, 3:25:50.125 PM'
                    })
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.INCIDENT_FAILED)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.getIncident('projectId', 'incidentId')(dispatch)
    })
})


describe('actions acknowledgeIncident multiple true', () => {
    it('should despatch ACKNOWLEDGE_INCIDENT_REQUEST and ACKNOWLEDGE_INCIDENT_SUCCESS  actions', () => {

        axiosMock.onPost(`${API_URL}/incident/projectId/acknowledge/incidentId`).reply(200, {
            _id: 'id here',
            date: 'February 14th, 3:25:50.125 PM',
            acknowledged: true
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.ACKNOWLEDGE_INCIDENT_REQUEST:
                    expect(dispatched.type).toEqual(actions.ACKNOWLEDGE_INCIDENT_REQUEST)
                    break;
                case actions.ACKNOWLEDGE_INCIDENT_SUCCESS:
                    expect(dispatched.type).toEqual(actions.ACKNOWLEDGE_INCIDENT_SUCCESS)
                    expect(dispatched.payload.data).toEqual({
                        _id: 'id here',
                        date: 'February 14th, 3:25:50.125 PM',
                        acknowledged: true
                    })
                    expect(dispatched.payload.multiple).toEqual(true)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.INCIDENT_FAILED)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.acknowledgeIncident('projectId', 'incidentId', 'userId', true)(dispatch)
    })
})

describe('actions resolveIncident multiple false', () => {
    it('should despatch ACKNOWLEDGE_INCIDENT_REQUEST and ACKNOWLEDGE_INCIDENT_SUCCESS  actions', () => {

        axiosMock.onPost(`${API_URL}/incident/projectId/acknowledge/incidentId`).reply(200, {
            _id: 'id here',
            date: 'February 14th, 3:25:50.125 PM',
            acknowledged: true
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.ACKNOWLEDGE_INCIDENT_REQUEST:
                    expect(dispatched.type).toEqual(actions.ACKNOWLEDGE_INCIDENT_REQUEST)
                    break;
                case actions.ACKNOWLEDGE_INCIDENT_SUCCESS:
                    expect(dispatched.type).toEqual(actions.ACKNOWLEDGE_INCIDENT_SUCCESS)
                    expect(dispatched.payload.data).toEqual({
                        _id: 'id here',
                        date: 'February 14th, 3:25:50.125 PM',
                        acknowledged: true
                    })
                    expect(dispatched.payload.multiple).toEqual(false)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.INCIDENT_FAILED)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.acknowledgeIncident('projectId', 'incidentId', 'userId', false)(dispatch)
    })
})

describe('actions resolveIncident multiple false', () => {
    it('should despatch RESOLVE_INCIDENT_REQUEST and RESOLVE_INCIDENT_REQUEST  actions', () => {

        axiosMock.onPost(`${API_URL}/incident/projectId/resolve/incidentId`).reply(200, {
            _id: 'id here',
            date: 'February 14th, 3:25:50.125 PM',
            acknowledged: true
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.RESOLVE_INCIDENT_REQUEST:
                    expect(dispatched.type).toEqual(actions.RESOLVE_INCIDENT_REQUEST)
                    break;
                case actions.RESOLVE_INCIDENT_SUCCESS:
                    expect(dispatched.type).toEqual(actions.RESOLVE_INCIDENT_SUCCESS)
                    expect(dispatched.payload.data).toEqual({
                        _id: 'id here',
                        date: 'February 14th, 3:25:50.125 PM',
                        acknowledged: true
                    })
                    expect(dispatched.payload.multiple).toEqual(false)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.INCIDENT_FAILED)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.resolveIncident('projectId', 'incidentId', 'userId', false)(dispatch)
    })
})

describe('actions resolveIncident multiple true', () => {
    it('should despatch RESOLVE_INCIDENT_REQUEST and RESOLVE_INCIDENT_REQUEST  actions', () => {

        axiosMock.onPost(`${API_URL}/incident/projectId/resolve/incidentId`).reply(200, {
            _id: 'id here',
            date: 'February 14th, 3:25:50.125 PM',
            acknowledged: true
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.RESOLVE_INCIDENT_REQUEST:
                    expect(dispatched.type).toEqual(actions.RESOLVE_INCIDENT_REQUEST)
                    break;
                case actions.RESOLVE_INCIDENT_SUCCESS:
                    expect(dispatched.type).toEqual(actions.RESOLVE_INCIDENT_SUCCESS)
                    expect(dispatched.payload.data).toEqual({
                        _id: 'id here',
                        date: 'February 14th, 3:25:50.125 PM',
                        acknowledged: true
                    })
                    expect(dispatched.payload.multiple).toEqual(true)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.INCIDENT_FAILED)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.resolveIncident('projectId', 'incidentId', 'userId', true)(dispatch)
    })
})


/*
  Test for Unresolved Incidents Section actions.
*/
describe('actions', () => {
    it('should create an action of type UNRESOLVED_INCIDENTS_REQUEST, promise in payload', () => {

        let promise = Promise.resolve('Unresolved incident request response')
        let action = actions.UnresolvedIncidentsRequest(promise)

        expect(action.type).toEqual(actions.UNRESOLVED_INCIDENTS_REQUEST)
        return action.payload.then(o => {
            expect(o).toEqual('Unresolved incident request response')
        })
    })
})

describe('actions', () => {
    it('should create an action of type UNRESOLVED_INCIDENTS_FAILED, error in payload', () => {
        const expectedAction = {
            type: actions.UNRESOLVED_INCIDENTS_FAILED,
            payload: 'error that occurred'
        }
        let action = actions.UnresolvedIncidentsError('error that occurred')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions', () => {
    it('should create an action of type UNRESOLVED_INCIDENTS_SUCCESS with incidents in payload', () => {
        const expectedAction = {
            type: actions.UNRESOLVED_INCIDENTS_SUCCESS,
            payload: 'incidents'
        }
        let action = actions.UnresolvedIncidentsSuccess('incidents')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions', () => {
    it('should create an action of type UNRESOLVED_INCIDENTS_RESET', () => {
        const expectedAction = {
            type: actions.UNRESOLVED_INCIDENTS_RESET,
        }
        expect(actions.resetUnresolvedIncidents().type).toEqual(expectedAction.type)
    })
})

describe('actions fetchUnresolvedIncidents', () => {
    it('should despatch UNRESOLVED_INCIDENTS_REQUEST and RESOLVE_INCIDENT_REQUEST  actions', () => {

        axiosMock.onGet(`${API_URL}/incident/projectId/unresolvedincidents`).reply(200, [], {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.UNRESOLVED_INCIDENTS_REQUEST:
                    expect(dispatched.type).toEqual(actions.UNRESOLVED_INCIDENTS_REQUEST)
                    break;
                case actions.UNRESOLVED_INCIDENTS_SUCCESS:
                    expect(dispatched.type).toEqual(actions.UNRESOLVED_INCIDENTS_SUCCESS)
                    expect(dispatched.payload).toEqual([])
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.UNRESOLVED_INCIDENTS_FAILED)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.fetchUnresolvedIncidents('projectId')(dispatch)
    })
})

/*
  Test for Internal notes and investigation notes Section actions.
*/
describe('actions', () => {
    it('should create an action of type INVESTIGATION_NOTE_REQUEST, promise in payload', () => {

        let promise = Promise.resolve('Investigation note request response')
        let call = actions.investigationNoteRequest(promise)

        expect(call.type).toEqual(actions.INVESTIGATION_NOTE_REQUEST)
        return call.payload.then(o => {
            expect(o).toEqual('Investigation note request response')
        })
    })
})

describe('actions', () => {
    it('should create an action of type INVESTIGATION_NOTE_FAILED, error in payload', () => {
        const expectedAction = {
            type: actions.INVESTIGATION_NOTE_FAILED,
            payload: 'error that occurred'
        }
        let action = actions.investigationNoteError('error that occurred')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions', () => {
    it('should create an action of type INVESTIGATION_NOTE_SUCCESS with incidents in payload', () => {
        const expectedAction = {
            type: actions.INVESTIGATION_NOTE_SUCCESS,
            payload: 'incident'
        }
        let action = actions.investigationNoteSuccess('incident')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions setInvestigationNote', () => {
    it('should despatch INVESTIGATION_NOTE_REQUEST and INVESTIGATION_NOTE_SUCCESS  actions', () => {

        axiosMock.onPost(`${API_URL}/incident/projectId/investigationNotes/incidentId`).reply(200, {
            status: 'success'
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.INVESTIGATION_NOTE_REQUEST:
                    expect(dispatched.type).toEqual(actions.INVESTIGATION_NOTE_REQUEST)
                    break;
                case actions.INVESTIGATION_NOTE_SUCCESS:
                    expect(dispatched.type).toEqual(actions.INVESTIGATION_NOTE_SUCCESS)
                    expect(dispatched.payload).toEqual({
                        status: 'success'
                    })
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.INVESTIGATION_NOTE_FAILED)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.setInvestigationNote('projectId', 'incidentId', 'test note')(dispatch)
    })
})


describe('actions', () => {
    it('should create an action of type INTERNAL_NOTE_REQUEST, promise in payload', () => {

        let promise = Promise.resolve('Internal note request response')
        let call = actions.internalNoteRequest(promise)

        expect(call.type).toEqual(actions.INTERNAL_NOTE_REQUEST)
        return call.payload.then(o => {
            expect(o).toEqual('Internal note request response')
        })
    })
})

describe('actions', () => {
    it('should create an action of type INTERNAL_NOTE_FAILED, error in payload', () => {
        const expectedAction = {
            type: actions.INTERNAL_NOTE_FAILED,
            payload: 'error that occurred'
        }
        let action = actions.internalNoteError('error that occurred')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions', () => {
    it('should create an action of type INTERNAL_NOTE_SUCCESS with incidents in payload', () => {
        const expectedAction = {
            type: actions.INTERNAL_NOTE_SUCCESS,
            payload: 'incident'
        }
        let action = actions.internalNoteSuccess('incident')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions setinternalNote', () => {
    it('should despatch INTERNAL_NOTE_REQUEST and INTERNAL_NOTE_SUCCESS  actions', () => {

        axiosMock.onPost(`${API_URL}/incident/projectId/internalNotes/incidentId`).reply(200, {
            status: 'success'
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.INTERNAL_NOTE_REQUEST:
                    expect(dispatched.type).toEqual(actions.INTERNAL_NOTE_REQUEST)
                    break;
                case actions.INTERNAL_NOTE_SUCCESS:
                    expect(dispatched.type).toEqual(actions.INTERNAL_NOTE_SUCCESS)
                    expect(dispatched.payload).toEqual({
                        status: 'success'
                    })
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.INTERNAL_NOTE_FAILED)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.setinternalNote('projectId', 'incidentId', 'test note')(dispatch)
    })
})