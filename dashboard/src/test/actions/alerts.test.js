import * as _actions from '../../actions/alert'
import * as _types from '../../constants/alert'
import axiosMock from '../axios_mock'
import {
  API_URL
} from '../../config'

/*
  Test for alert actions.
  General alerts
*/
const actions = {..._actions,..._types}

describe('actions', () => {
  it('should create an action of type ALERT_FETCH_RESET', () => {
    const expectedAction = {
      type: actions.ALERT_FETCH_RESET,
    }
    expect(actions.resetAlert().type).toEqual(expectedAction.type)
  })
})

describe('actions', async () => {
  it('should create an action of type ALERT_FETCH_REQUEST, and Return promise in payload', () => {

    let promise = Promise.resolve('alert fetch response')
    let action = actions.alertRequest(promise)

    expect(action.type).toEqual(actions.ALERT_FETCH_REQUEST)
    return action.payload.then(o => {
      expect(o).toEqual('alert fetch response')
    })
  })
})

describe('actions', () => {
  it('should create an action of type ALERT_FETCH_FAILED', () => {
    const expectedAction = {
      type: actions.ALERT_FETCH_FAILED,
      payload: 'error that occurred'
    }
    let action = actions.alertError('error that occurred')
    expect(action.type).toEqual(expectedAction.type)
    expect(action.payload).toEqual(expectedAction.payload)
  })
})

describe('actions', () => {
  it('should create an action of type ALERT_FETCH_SUCCESS or ALERT_FETCH_FAILED , and alert in payload', () => {
    let action = actions.alertSuccess('alert')
    expect(action.type).toEqual(actions.ALERT_FETCH_SUCCESS)
    expect(action.payload).toEqual('alert')
  })
})

describe('actions', () => {
  it('should despatch ALERT_FETCH_REQUEST and ALERT_FETCH_SUCCESS  actions', () => {

    axiosMock.onGet(`${API_URL}/alert/projectId/getAlerts?skip=5&limit=10`).reply(200, [], {});

    let dispatch = (dispatched) => {
      switch (dispatched.type) {
        case actions.ALERT_FETCH_SUCCESS:
          expect(dispatched.type).toEqual(actions.ALERT_FETCH_SUCCESS)
          expect(dispatched.payload).toEqual([])
          break;
        case actions.ALERT_FETCH_REQUEST:
          expect(dispatched.type).toEqual(actions.ALERT_FETCH_REQUEST)
         
          break;
        default:
          expect(dispatched.type).toEqual(actions.ALERT_FETCH_FAILED)
          expect(dispatched.payload).toEqual('fail test')
      }
    }
    let action = actions.fetchAlert('projectId', 5, 10)(dispatch)
  })
})

/*
  Test for alert actions.
  Incident alerts
*/
describe('actions', () => {
  it('should create an action of type INCIDENTS_ALERT_FETCH_RESET', () => {
    const expectedAction = {
      type: actions.INCIDENTS_ALERT_FETCH_RESET,
    }
    expect(actions.incidentResetAlert()).toEqual(expectedAction)
  })
})

describe('actions', async () => {
  it('should create an action of type INCIDENTS_ALERT_FETCH_REQUEST, and Return promise in payload', () => {

    let promise = Promise.resolve('incident alert fetch response')
    let call = actions.incidentAlertRequest(promise)

    expect(call.type).toEqual(actions.INCIDENTS_ALERT_FETCH_REQUEST)
    call.payload.then(o => {
        return expect(o).toEqual('incident alert fetch response')
      })
      .catch(e => {
        return expect(e).toEqual('known error')
      })
  })
})

describe('actions', () => {
  it('should create an action of type INCIDENTS_ALERT_FETCH_FAILED with error in payload', () => {
    const expectedAction = {
      type: actions.INCIDENTS_ALERT_FETCH_FAILED,
      payload: 'incident alert error'
    }
    let action = actions.incidentAlertError('incident alert error')
    expect(action.type).toEqual(expectedAction.type)
    expect(action.payload).toEqual(expectedAction.payload)
  })
})

describe('actions', () => {
  it('should create an action of type INCIDENTS_ALERT_FETCH_SUCCESS with alert in payload', () => {
    const expectedAction = {
      type: actions.INCIDENTS_ALERT_FETCH_SUCCESS,
      payload: 'alert'
    }
    let action = actions.incidentAlertSuccess('alert')
    expect(action.type).toEqual(expectedAction.type)
    expect(action.payload).toEqual(expectedAction.payload)
  })
})

describe('actions', () => {
  it('should despatch ALERT_FETCH_REQUEST and ALERT_FETCH_SUCCESS  actions', () => {

    axiosMock.onGet(`${API_URL}/alert/projectId/incidentId/getIncidentAlerts?skip=5&limit=10`).reply(200, [], {});

    let dispatch = (dispatched) => {
      switch (dispatched.type) {
        case actions.INCIDENTS_ALERT_FETCH_SUCCESS:
          expect(dispatched.type).toEqual(actions.INCIDENTS_ALERT_FETCH_SUCCESS)
          expect(dispatched.payload).toEqual([])
          break;
        case actions.INCIDENTS_ALERT_FETCH_REQUEST:
          expect(dispatched.type).toEqual(actions.INCIDENTS_ALERT_FETCH_REQUEST)
         
          break;
        default:
          expect(dispatched.type).toEqual(actions.INCIDENTS_ALERT_FETCH_FAILED)
          expect(dispatched.payload).toEqual('fail test')
      }
    }
    let action = actions.fetchIncidentAlert('projectId','incidentId', 5, 10)(dispatch)
  })
})