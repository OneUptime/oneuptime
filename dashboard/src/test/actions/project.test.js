import axiosMock from '../axios_mock'
import {
    API_URL
} from '../../config'
import * as _actions from '../../actions/project'
import * as _types from '../../constants/project'

const actions = {..._actions, ..._types}

//Update profile setting

describe('actions', () => {
    it('should create an action of type SHOW_DELETE_MODAL', () => {
        const expectedAction = {
            type: actions.SHOW_DELETE_MODAL,
        }
        expect(actions.showDeleteModal().type).toEqual(expectedAction.type)
    })
})

describe('actions', () => {
    it('should create an action of type HIDE_DELETE_MODAL', () => {
        const expectedAction = {
            type: actions.HIDE_DELETE_MODAL,
        }
        expect(actions.hideDeleteModal().type).toEqual(expectedAction.type)
    })
})

describe('actions', () => {
    it('should create an action of type SHOW_PROJECT_FORM', () => {
        const expectedAction = {
            type: actions.SHOW_PROJECT_FORM,
        }
        expect(actions.showForm().type).toEqual(expectedAction.type)
    })
})
describe('actions', () => {
    it('should create an action of type HIDE_PROJECT_FORM', () => {
        const expectedAction = {
            type: actions.HIDE_PROJECT_FORM,
        }
        expect(actions.hideForm().type).toEqual(expectedAction.type)
    })
})

// new batch

describe('actions', () => {
    it('should create an action of type PROJECTS_REQUEST, promise in payload', () => {
        const expectedAction = {
            type: actions.PROJECTS_REQUEST,
        }
        let action = actions.projectsRequest(Promise.resolve(true))
        expect(action.type).toEqual(expectedAction.type)
        return action.payload.then((o) => expect(o).toEqual(true))
    })
})

describe('actions', () => {
    it('should create an action of type PROJECTS_FAILED, error in payload', () => {
        const expectedAction = {
            type: actions.PROJECTS_FAILED,
        }
        let action = actions.projectsError('error')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual('error')
    })
})

describe('actions', () => {
    it('should create an action of type PROJECTS_SUCCESS, projects in payload', () => {
        const expectedAction = {
            type: actions.PROJECTS_SUCCESS,
        }
        let action = actions.projectsSuccess([])
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual([])
    })
})

describe('actions', () => {
    it('should create an action of type PROJECTS_RESET', () => {
        const expectedAction = {
            type: actions.PROJECTS_RESET,
        }
        let action = actions.resetProjects()
        expect(action.type).toEqual(expectedAction.type)
    })
})

describe('actions', () => {
    it('should despatch a bunch of error actions', () => {

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.PROJECTS_REQUEST:
                    expect(dispatched.type).toEqual(actions.PROJECTS_REQUEST)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.PROJECTS_FAILED)
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
            }
        }
        let action = actions.getProjects()(dispatch)
    })
})

describe('actions', () => {
    it('should despatch a bunch of error actions', () => {

        axiosMock.onGet(`${API_URL}/project/projects`).reply(200, [{
            _id: '123456789'
        }], {});

        let dispatch = (dispatched) => {

            switch (dispatched.type) {
                case actions.PROJECTS_SUCCESS:
                    expect(dispatched.type).toEqual(actions.PROJECTS_SUCCESS)
                    break;
                case 'alert/ALERT_FETCH_RESET':
                    expect(dispatched.type).toEqual('alert/ALERT_FETCH_RESET')
                    break;
                case 'schedule/SCHEDULE_FETCH_RESET':
                    expect(dispatched.type).toEqual('schedule/SCHEDULE_FETCH_RESET')
                    break;
                case 'FETCH_MONITORS_RESET':
                    expect(dispatched.type).toEqual('FETCH_MONITORS_RESET')
                    break;
                case 'incidents/UNRESOLVED_INCIDENTS_RESET':
                    expect(dispatched.type).toEqual('incidents/UNRESOLVED_INCIDENTS_RESET')
                    break;
                case 'CREATE_MONITOR_RESET':
                    expect(dispatched.type).toEqual('CREATE_MONITOR_RESET')
                    break;
                case 'FETCH_STATUSPAGE_RESET':
                    expect(dispatched.type).toEqual('FETCH_STATUSPAGE_RESET')
                    break;
                case 'feedback/FETCH_NOTIFICATIONS_RESET':
                    expect(dispatched.type).toEqual('feedback/FETCH_NOTIFICATIONS_RESET')
                    break;
                case 'FETCH_STATUSPAGE_REQUEST':
                    expect(dispatched.type).toEqual('FETCH_STATUSPAGE_REQUEST')
                    break;
                case 'alert/ALERT_FETCH_REQUEST':
                    expect(dispatched.type).toEqual('alert/ALERT_FETCH_REQUEST')
                    break;
                case 'incidents/UNRESOLVED_INCIDENTS_REQUEST':
                    expect(dispatched.type).toEqual('incidents/UNRESOLVED_INCIDENTS_REQUEST')
                    break;
                case 'FETCH_MONITORS_REQUEST':
                    expect(dispatched.type).toEqual('FETCH_MONITORS_REQUEST')
                    break;
                case 'schedule/SCHEDULE_FETCH_REQUEST':
                    expect(dispatched.type).toEqual('schedule/SCHEDULE_FETCH_REQUEST')
                    break;
                case 'feedback/FETCH_NOTIFICATIONS_REQUEST':
                    expect(dispatched.type).toEqual('feedback/FETCH_NOTIFICATIONS_REQUEST')
                    break;
                case 'projects/SWITCH_PROJECT':
                    expect(dispatched.type).toEqual('projects/SWITCH_PROJECT')
                    break;
                case 'alert/ALERT_FETCH_FAILED':
                    expect(dispatched.type).toEqual('alert/ALERT_FETCH_FAILED')
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
                    break;
                case 'FETCH_STATUSPAGE_FAILURE':
                    expect(dispatched.type).toEqual('FETCH_STATUSPAGE_FAILURE')
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
                    break;
                case 'FETCH_MONITORS_FAILURE':
                    expect(dispatched.type).toEqual('FETCH_MONITORS_FAILURE')
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
                    break;
                case 'incidents/UNRESOLVED_INCIDENTS_FAILED':
                    expect(dispatched.type).toEqual('incidents/UNRESOLVED_INCIDENTS_FAILED')
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
                    break;
                case 'schedule/SCHEDULE_FETCH_FAILED':
                    expect(dispatched.type).toEqual('schedule/SCHEDULE_FETCH_FAILED')
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
                    break;
                case 'feedback/FETCH_NOTIFICATIONS_FAILED':
                    expect(dispatched.type).toEqual('feedback/FETCH_NOTIFICATIONS_FAILED')
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
                    break;
                case actions.PROJECTS_REQUEST:
                    expect(dispatched.type).toEqual(actions.PROJECTS_REQUEST)
                    return dispatched.payload.then((o) => expect(o).toEqual({
                        data: 'data'
                    }))
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.PROJECTS_FAILED)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.getProjects()(dispatch)
    })
})
describe('actions', () => {
    it('should despatch a bunch of success actions', () => {

        axiosMock.onGet(`${API_URL}/project/projects`).reply(200, [{
            _id: 'projectId'
        }], {});
        axiosMock.onGet(`${API_URL}/alert/projectId/getAlerts?skip=undefined&limit=undefined`).reply(200, [{
            _id: 'alertid'
        }], {});
        axiosMock.onGet(`${API_URL}/statusPage/projectId/statusPages`).reply(200, {
            data: 'status page'
        }, {});
        axiosMock.onGet(`${API_URL}/monitor/projectId/monitors`).reply(200, [{
            _id: 'id one'
        }], {});

        axiosMock.onGet(`${API_URL}/incident/projectId/unresolvedincidents`).reply(200, [{
            _id: 'id one'
        }], {});
        axiosMock.onGet(`${API_URL}/schedule/projectId/projectSchedules`).reply(200, [{
            _id: 'id one'
        }], {});

        axiosMock.onGet(`${API_URL}/notification/projectId/getNotifications`).reply(200, [{
            _id: 'id one'
        }], {});

        let dispatch = (dispatched) => {

            switch (dispatched.type) {
                case actions.PROJECTS_SUCCESS:
                    expect(dispatched.type).toEqual(actions.PROJECTS_SUCCESS)
                    break;
                case 'alert/ALERT_FETCH_RESET':
                    expect(dispatched.type).toEqual('alert/ALERT_FETCH_RESET')
                    break;
                case 'schedule/SCHEDULE_FETCH_RESET':
                    expect(dispatched.type).toEqual('schedule/SCHEDULE_FETCH_RESET')
                    break;
                case 'FETCH_MONITORS_RESET':
                    expect(dispatched.type).toEqual('FETCH_MONITORS_RESET')
                    break;
                case 'incidents/UNRESOLVED_INCIDENTS_RESET':
                    expect(dispatched.type).toEqual('incidents/UNRESOLVED_INCIDENTS_RESET')
                    break;
                case 'CREATE_MONITOR_RESET':
                    expect(dispatched.type).toEqual('CREATE_MONITOR_RESET')
                    break;
                case 'FETCH_STATUSPAGE_RESET':
                    expect(dispatched.type).toEqual('FETCH_STATUSPAGE_RESET')
                    break;
                case 'subProjects/SUBPROJECTS_RESET':
                    expect(dispatched.type).toEqual('subProjects/SUBPROJECTS_RESET')
                    break;
                case 'feedback/FETCH_NOTIFICATIONS_RESET':
                    expect(dispatched.type).toEqual('feedback/FETCH_NOTIFICATIONS_RESET')
                    break;
                case 'FETCH_STATUSPAGE_REQUEST':
                    expect(dispatched.type).toEqual('FETCH_STATUSPAGE_REQUEST')
                    break;
                case 'subProject/SUBPROJECT_REQUEST':
                    expect(dispatched.type).toEqual('SUBPROJECT_REQUEST')
                    break;
                case 'alert/ALERT_FETCH_REQUEST':
                    expect(dispatched.type).toEqual('alert/ALERT_FETCH_REQUEST')
                    break;
                case 'incidents/UNRESOLVED_INCIDENTS_REQUEST':
                    expect(dispatched.type).toEqual('incidents/UNRESOLVED_INCIDENTS_REQUEST')
                    break;
                case 'FETCH_MONITORS_REQUEST':
                    expect(dispatched.type).toEqual('FETCH_MONITORS_REQUEST')
                    break;
                case 'schedule/SCHEDULE_FETCH_REQUEST':
                    expect(dispatched.type).toEqual('schedule/SCHEDULE_FETCH_REQUEST')
                    break;
                case 'feedback/FETCH_NOTIFICATIONS_REQUEST':
                    expect(dispatched.type).toEqual('feedback/FETCH_NOTIFICATIONS_REQUEST')
                    break;
                case 'projects/SWITCH_PROJECT':
                    expect(dispatched.type).toEqual('projects/SWITCH_PROJECT')
                    break;
                case 'alert/ALERT_FETCH_FAILED':
                    expect(dispatched.type).toEqual('alert/ALERT_FETCH_FAILED')
                    expect(dispatched.payload).toEqual('fail test')
                    break;
                case 'alert/ALERT_FETCH_SUCCESS':
                    expect(dispatched.type).toEqual('alert/ALERT_FETCH_SUCCESS')
                    expect(dispatched.payload).toEqual([{
                        "_id": "alertid"
                    }])
                    break;
                case 'FETCH_STATUSPAGE_FAILURE':
                    expect(dispatched.type).toEqual('FETCH_STATUSPAGE_FAILURE')
                    expect(dispatched.payload).toEqual('fail test')
                    break;
                case 'subProjects/SUBPROJECTS_FAILURE':
                    expect(dispatched.type).toEqual('SUBPROJECTS_FAILURE')
                    expect(dispatched.payload).toEqual('fail test')
                    break;
                case 'FETCH_STATUSPAGE_SUCCESS':
                    expect(dispatched.type).toEqual('FETCH_STATUSPAGE_SUCCESS')
                    expect(dispatched.payload).toEqual({
                        "data": "status page"
                    })
                    break;
                case 'subProjects/SUBPROJECTS_SUCCESS':
                    expect(dispatched.type).toEqual('SUBPROJECTS_SUCCESS')
                    expect(dispatched.payload).toEqual({
                        "data": "subproject page"
                    })
                    break;
                case 'FETCH_MONITORS_FAILURE':
                    expect(dispatched.type).toEqual('FETCH_MONITORS_FAILURE')
                    expect(dispatched.payload).toEqual('fail test')
                    break;
                case 'FETCH_MONITORS_SUCCESS':
                    expect(dispatched.type).toEqual('FETCH_MONITORS_SUCCESS')
                    expect(dispatched.payload).toEqual([{
                        _id: 'id one'
                    }])
                    break;
                case 'incidents/UNRESOLVED_INCIDENTS_FAILED':
                    expect(dispatched.type).toEqual('incidents/UNRESOLVED_INCIDENTS_FAILED')
                    expect(dispatched.payload).toEqual('fail test')
                    break;
                case 'incidents/UNRESOLVED_INCIDENTS_SUCCESS':
                    expect(dispatched.type).toEqual('incidents/UNRESOLVED_INCIDENTS_SUCCESS')
                    expect(dispatched.payload).toEqual([{
                        _id: 'id one'
                    }])
                    break;
                case 'schedule/SCHEDULE_FETCH_FAILED':
                    expect(dispatched.type).toEqual('schedule/SCHEDULE_FETCH_FAILED')
                    expect(dispatched.payload).toEqual('fail test')
                    break;
                case 'schedule/SCHEDULE_FETCH_SUCCESS':
                    expect(dispatched.type).toEqual('schedule/SCHEDULE_FETCH_SUCCESS')
                    expect(dispatched.payload).toEqual([{
                        _id: 'id one'
                    }])
                    break;
                case 'feedback/FETCH_NOTIFICATIONS_FAILED':
                    expect(dispatched.type).toEqual('feedback/FETCH_NOTIFICATIONS_FAILED')
                    // expect(dispatched.payload).toEqual('fail test')
                    break;
                case 'feedback/FETCH_NOTIFICATIONS_SUCCESS':
                    expect(dispatched.type).toEqual('feedback/FETCH_NOTIFICATIONS_SUCCESS')
                    expect(dispatched.payload).toEqual([{
                        _id: 'id one'
                    }])
                    break;

                case actions.PROJECTS_REQUEST:
                    expect(dispatched.type).toEqual(actions.PROJECTS_REQUEST)
                    return dispatched.payload.then((o) => expect(o).toEqual({
                        data: 'data'
                    }))
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.PROJECTS_FAILED)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.getProjects()(dispatch)
    })
})


describe('actions', () => {
    it('should create an action of type CREATE_PROJECT_REQUEST', () => {
        const expectedAction = {
            type: actions.CREATE_PROJECT_REQUEST,
        }
        expect(actions.createProjectRequest().type).toEqual(expectedAction.type)
    })
})

describe('actions', () => {
    it('should create an action of type CREATE_PROJECT_RESET', () => {
        const expectedAction = {
            type: actions.CREATE_PROJECT_RESET,
        }
        expect(actions.resetCreateProject().type).toEqual(expectedAction.type)
    })
})
describe('actions', () => {
    it('should create an action of type CREATE_PROJECT_FAILED', () => {
        const expectedAction = {
            type: actions.CREATE_PROJECT_FAILED,
            payload: 'error that occurred'
        }
        let action = actions.createProjectError('error that occurred')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions', () => {
    it('should create an action of type CREATE_PROJECT_SUCCESS, and project in payload', () => {
        let action = actions.createProjectSuccess('project')
        expect(action.type).toEqual(actions.CREATE_PROJECT_SUCCESS)
        expect(action.payload).toEqual('project')
    })
})

describe('actions', () => {
    it('should despatch CREATE_PROJECT_FAILED with Request failed with status code 404 error', () => {

        axiosMock.onPost(`${API_URL}/project/createxx`).reply(200, {
            data: 'response'
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.CREATE_PROJECT_SUCCESS:
                    expect(dispatched.type).toEqual(actions.CREATE_PROJECT_SUCCESS)
                    expect(dispatched.payload).toEqual({
                        "data": "response"
                    })
                    break;
                case actions.CREATE_PROJECT_REQUEST:
                    expect(dispatched.type).toEqual(actions.CREATE_PROJECT_REQUEST)

                    break;
                default:
                    expect(dispatched.type).toEqual(actions.CREATE_PROJECT_FAILED)
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
            }
        }
        let action = actions.createProject({})(dispatch)
    })
})

describe('actions', () => {
    it('should despatch CREATE_PROJECT_REQUEST and CREATE_PROJECT_SUCCESS  actions', () => {

        axiosMock.onPost(`${API_URL}/project/create`).reply(200, {
            data: 'response'
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.CREATE_PROJECT_SUCCESS:
                    expect(dispatched.type).toEqual(actions.CREATE_PROJECT_SUCCESS)
                    expect(dispatched.payload).toEqual({
                        "data": "response"
                    })
                    break;
                case actions.CREATE_PROJECT_REQUEST:
                    expect(dispatched.type).toEqual(actions.CREATE_PROJECT_REQUEST)

                    break;
                default:
                    expect(dispatched.type).toEqual(actions.CREATE_PROJECT_FAILED)
                    expect(dispatched.payload).toEqual('fail test')
            }
        }
        let action = actions.createProject({})(dispatch)
    })
})

// Project switching

describe('actions', () => {
    it('should create an action of type SWITCH_PROJECT_RESET', () => {
        let action = actions.switchProjectReset()
        expect(action.type).toEqual(actions.SWITCH_PROJECT_RESET)
    })
})
describe('actions', () => {
    it('should create an action of type HIDE_PROJECT_SWITCHER', () => {
        let action = actions.showProjectSwitcher()
        expect(action.type).toEqual(actions.SHOW_PROJECT_SWITCHER)
    })
})
describe('actions', () => {
    it('should create an action of type SWITCH_PROJECT_RESET', () => {
        let action = actions.hideProjectSwitcher()
        expect(action.type).toEqual(actions.HIDE_PROJECT_SWITCHER)
    })
})

// describe('actions', () => {
//     it('should despatch a bunch of project actions', () => {

//         let dispatch = (dispatched) => {

//             switch (dispatched.type) {
//                 case 'alert/ALERT_FETCH_RESET':
//                     expect(dispatched.type).toEqual('alert/ALERT_FETCH_RESET')
//                     break;
//                 case 'schedule/SCHEDULE_FETCH_RESET':
//                     expect(dispatched.type).toEqual('schedule/SCHEDULE_FETCH_RESET')
//                     break;
//                 case 'FETCH_MONITORS_RESET':
//                     expect(dispatched.type).toEqual('FETCH_MONITORS_RESET')
//                     break;
//                 case 'incidents/UNRESOLVED_INCIDENTS_RESET':
//                     expect(dispatched.type).toEqual('incidents/UNRESOLVED_INCIDENTS_RESET')
//                     break;
//                 case 'CREATE_MONITOR_RESET':
//                     expect(dispatched.type).toEqual('CREATE_MONITOR_RESET')
//                     break;
//                 case 'FETCH_STATUSPAGE_RESET':
//                     expect(dispatched.type).toEqual('FETCH_STATUSPAGE_RESET')
//                     break;
//                 case 'feedback/FETCH_NOTIFICATIONS_RESET':
//                     expect(dispatched.type).toEqual('feedback/FETCH_NOTIFICATIONS_RESET')
//                     break;
//                 case 'statusPage/FETCH_SUBPROJECT_STATUSPAGE_RESET':
//                     expect(dispatched.type).toEqual('FETCH_SUBPROJECT_STATUSPAGE_RESET')
//                     break;
//                 case 'FETCH_STATUSPAGE_REQUEST':
//                     expect(dispatched.type).toEqual('FETCH_STATUSPAGE_REQUEST')
//                     break;
//                 case 'FETCH_SUBPROJECT_STATUSPAGE_REQUEST':
//                     expect(dispatched.type).toEqual('FETCH_SUBPROJECT_STATUSPAGE_REQUEST')
//                     break;
//                 case 'alert/ALERT_FETCH_REQUEST':
//                     expect(dispatched.type).toEqual('alert/ALERT_FETCH_REQUEST')
//                     break;
//                 case 'incidents/UNRESOLVED_INCIDENTS_REQUEST':
//                     expect(dispatched.type).toEqual('incidents/UNRESOLVED_INCIDENTS_REQUEST')
//                     break;
//                 case 'FETCH_MONITORS_REQUEST':
//                     expect(dispatched.type).toEqual('FETCH_MONITORS_REQUEST')
//                     break;
//                 case 'subProjects/SUBPROJECTS_REQUEST':
//                     expect(dispatched.type).toEqual('SUBPROJECTS_REQUEST')
//                     break;
//                 case 'schedule/SCHEDULE_FETCH_REQUEST':
//                     expect(dispatched.type).toEqual('schedule/SCHEDULE_FETCH_REQUEST')
//                     break;
//                 case 'feedback/FETCH_NOTIFICATIONS_REQUEST':
//                     expect(dispatched.type).toEqual('feedback/FETCH_NOTIFICATIONS_REQUEST')
//                     break;
//                 case 'projects/SWITCH_PROJECT':
//                     expect(dispatched.type).toEqual('projects/SWITCH_PROJECT')
//                     break;
//                 case 'alert/ALERT_FETCH_FAILED':
//                     expect(dispatched.type).toEqual('alert/ALERT_FETCH_FAILED')
//                     expect(dispatched.payload).toEqual('fail test')
//                     break;
//                 case 'alert/ALERT_FETCH_SUCCESS':
//                     expect(dispatched.type).toEqual('alert/ALERT_FETCH_SUCCESS')
//                     expect(dispatched.payload).toEqual([{
//                         "_id": "statusPageid"
//                     }])
//                 case 'FETCH_SUBPROJECT_STATUSPAGE_RESET':
//                     expect(dispatched.type).toEqual('FETCH_SUBPROJECT_STATUSPAGE_RESET')
//                     break;
//                 case 'FETCH_STATUSPAGE_FAILURE':
//                     expect(dispatched.type).toEqual('FETCH_STATUSPAGE_FAILURE')
//                     expect(dispatched.payload).toEqual('fail test')
//                     break;
//                 case 'statusPage/FETCH_SUBPROJECT_STATUSPAGE_SUCCESS':
//                     expect(dispatched.type).toEqual('FETCH_SUBPROJECT_STATUSPAGE_SUCCESS')
//                     expect(dispatched.payload).toEqual('fail test')
//                     break;
//                 case 'FETCH_STATUSPAGE_SUCCESS':
//                     expect(dispatched.type).toEqual('FETCH_STATUSPAGE_SUCCESS')
//                     expect(dispatched.payload).toEqual({
//                         "data": "status page"
//                     })
//                     break;
//                 case 'FETCH_MONITORS_FAILURE':
//                     expect(dispatched.type).toEqual('FETCH_MONITORS_FAILURE')
//                     expect(dispatched.payload).toEqual('fail test')
//                     break;
//                 case 'FETCH_SUBPROJECT_STATUSPAGE_FAILURE':
//                     expect(dispatched.type).toEqual('FETCH_SUBPROJECT_STATUSPAGE_FAILURE')
//                     expect(dispatched.payload).toEqual('fail test')
//                     break;
//                 case 'FETCH_MONITORS_SUCCESS':
//                     expect(dispatched.type).toEqual('FETCH_MONITORS_SUCCESS')
//                     expect(dispatched.payload).toEqual([{
//                         _id: 'id one'
//                     }])
//                     break;
//                 case 'incidents/UNRESOLVED_INCIDENTS_FAILED':
//                     expect(dispatched.type).toEqual('incidents/UNRESOLVED_INCIDENTS_FAILED')
//                     expect(dispatched.payload).toEqual('fail test')
//                     break;
//                 case 'incidents/UNRESOLVED_INCIDENTS_SUCCESS':
//                     expect(dispatched.type).toEqual('incidents/UNRESOLVED_INCIDENTS_SUCCESS')
//                     expect(dispatched.payload).toEqual([{
//                         _id: 'id one'
//                     }])
//                     break;
//                 case 'schedule/SCHEDULE_FETCH_FAILED':
//                     expect(dispatched.type).toEqual('schedule/SCHEDULE_FETCH_FAILED')
//                     expect(dispatched.payload).toEqual('fail test')
//                     break;
//                 case 'schedule/SCHEDULE_FETCH_SUCCESS':
//                     expect(dispatched.type).toEqual('schedule/SCHEDULE_FETCH_SUCCESS')
//                     expect(dispatched.payload).toEqual([{
//                         _id: 'id one'
//                     }])
//                     break; 
//                 case 'feedback/FETCH_NOTIFICATIONS_FAILED':
//                     expect(dispatched.type).toEqual('feedback/FETCH_NOTIFICATIONS_FAILED')
//                     // expect(dispatched.payload).toEqual('fail test')
//                     break;
//                 case 'feedback/FETCH_NOTIFICATIONS_SUCCESS':
//                     expect(dispatched.type).toEqual('feedback/FETCH_NOTIFICATIONS_SUCCESS')
//                     expect(dispatched.payload).toEqual([{
//                         _id: 'id one'
//                     }])
//                     break;
//                 case 'subProjects/SUBPROJECTS_RESET':
//                     expect('subProjects/SUBPROJECTS_RESET').toEqual('subProjects/SUBPROJECTS_RESET')
//                     break;
//                 default:
//                     expect(dispatched.type).toEqual(actions.PROJECTS_FAILED)
//                     expect(dispatched.payload).toEqual('fail test')
//             }
//         }
//         let action = actions.switchProject(dispatch, {
//             _id: 'projectId'
//         })
//         expect(action.type).toEqual(actions.SWITCH_PROJECT)
//     })
// })

//Project Token actions
describe('actions', () => {
    it('should create an action of type RESET_PROJECT_TOKEN_RESET', () => {
        const expectedAction = {
            type: actions.RESET_PROJECT_TOKEN_RESET,
        }
        expect(actions.resetProjectTokenReset().type).toEqual(expectedAction.type)
    })
})

describe('actions', async () => {
    it('should create an action of type RESET_PROJECT_TOKEN_REQUEST', () => {

        let action = actions.resetProjectTokenRequest()

        expect(action.type).toEqual(actions.RESET_PROJECT_TOKEN_REQUEST)
    })
})

describe('actions', () => {
    it('should create an action of type RESET_PROJECT_TOKEN_FAILED', () => {
        const expectedAction = {
            type: actions.RESET_PROJECT_TOKEN_FAILED,
            payload: 'error that occurred'
        }
        let action = actions.resetProjectTokenError('error that occurred')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions', () => {
    it('should create an action of type RESET_PROJECT_TOKEN_SUCCESS', () => {
        let action = actions.resetProjectTokenSuccess({
            data: "data"
        })
        expect(action.type).toEqual(actions.RESET_PROJECT_TOKEN_SUCCESS)
        expect(action.payload).toEqual('data')
    })
})

describe('actions', () => {
    it('should despatch RESET_PROJECT_TOKEN_REQUEST and RESET_PROJECT_TOKEN_SUCCESS  actions', () => {

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.RESET_PROJECT_TOKEN_SUCCESS:
                    expect(dispatched.type).toEqual(actions.RESET_PROJECT_TOKEN_SUCCESS)
                    expect(dispatched.payload).toEqual([])
                    break;
                case actions.RESET_PROJECT_TOKEN_RESET:
                    expect(dispatched.type).toEqual(actions.RESET_PROJECT_TOKEN_RESET)
                    break;
                case actions.RESET_PROJECT_TOKEN_REQUEST:
                    expect(dispatched.type).toEqual(actions.RESET_PROJECT_TOKEN_REQUEST)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.RESET_PROJECT_TOKEN_FAILED)
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
                    break;
            }
        }
        let action = actions.resetProjectToken('projectId')(dispatch)
    })
})

describe('actions', () => {
    it('should despatch RESET_PROJECT_TOKEN_REQUEST and RESET_PROJECT_TOKEN_SUCCESS  actions', () => {

        axiosMock.onGet(`${API_URL}/project/projectId/resetToken`).reply(200, {
            data: 'token'
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.RESET_PROJECT_TOKEN_SUCCESS:
                    expect(dispatched.type).toEqual(actions.RESET_PROJECT_TOKEN_SUCCESS)
                    expect(dispatched.payload).toEqual({
                        "data": "token"
                    })
                    break;
                case actions.RESET_PROJECT_TOKEN_RESET:
                    expect(dispatched.type).toEqual(actions.RESET_PROJECT_TOKEN_RESET)
                    break;
                case actions.RESET_PROJECT_TOKEN_REQUEST:
                    expect(dispatched.type).toEqual(actions.RESET_PROJECT_TOKEN_REQUEST)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.RESET_PROJECT_TOKEN_FAILED)
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
                    break;
            }
        }
        let action = actions.resetProjectToken('projectId')(dispatch)
    })
})

// Rename projects

describe('actions', () => {
    it('should create an action of type RENAME_PROJECT_RESET', () => {
        const expectedAction = {
            type: actions.RENAME_PROJECT_RESET,
        }
        expect(actions.renameProjectReset().type).toEqual(expectedAction.type)
    })
})

describe('actions', async () => {
    it('should create an action of type RENAME_PROJECT_REQUEST', () => {

        let action = actions.renameProjectRequest()

        expect(action.type).toEqual(actions.RENAME_PROJECT_REQUEST)
    })
})

describe('actions', () => {
    it('should create an action of type RENAME_PROJECT_SUCCESS', () => {
        let action = actions.renameProjectSuccess({
            data: "data"
        })
        expect(action.type).toEqual(actions.RENAME_PROJECT_SUCCESS)
        expect(action.payload).toEqual('data')
    })
})

describe('actions', () => {
    it('should create an action of type RENAME_PROJECT_FAILED', () => {
        const expectedAction = {
            type: actions.RENAME_PROJECT_FAILED,
            payload: 'error that occurred'
        }
        let action = actions.renameProjectError('error that occurred')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions', () => {
    it('should despatch RENAME_PROJECT_FAILED error action', () => {

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.RENAME_PROJECT_SUCCESS:
                    expect(dispatched.type).toEqual(actions.RENAME_PROJECT_SUCCESS)
                    expect(dispatched.payload).toEqual([])
                    break;
                case actions.RESET_PROJECT_TOKEN_RESET:
                    expect(dispatched.type).toEqual(actions.RESET_PROJECT_TOKEN_RESET)
                    break;
                case actions.RENAME_PROJECT_REQUEST:
                    expect(dispatched.type).toEqual(actions.RENAME_PROJECT_REQUEST)
                    break;
                case actions.RENAME_PROJECT_RESET:
                    expect(dispatched.type).toEqual(actions.RENAME_PROJECT_RESET)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.RENAME_PROJECT_FAILED)
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
                    break;
            }
        }
        let action = actions.renameProject('projectId', 'project name')(dispatch)
    })
})

describe('actions', () => {
    it('should despatch RENAME_PROJECT_FAILED error action', () => {

        axiosMock.onPost(`${API_URL}/project/projectId/renameProject`).reply(200, {
            data: 'renamed project'
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.RENAME_PROJECT_SUCCESS:
                    expect(dispatched.type).toEqual(actions.RENAME_PROJECT_SUCCESS)
                    expect(dispatched.payload).toEqual({
                        "data": "renamed project"
                    })
                    break;
                case actions.RESET_PROJECT_TOKEN_RESET:
                    expect(dispatched.type).toEqual(actions.RESET_PROJECT_TOKEN_RESET)
                    break;
                case actions.RENAME_PROJECT_REQUEST:
                    expect(dispatched.type).toEqual(actions.RENAME_PROJECT_REQUEST)
                    break;
                case actions.RENAME_PROJECT_RESET:
                    expect(dispatched.type).toEqual(actions.RENAME_PROJECT_RESET)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.RENAME_PROJECT_FAILED)
                    expect(dispatched.payload).toEqual('fail test')
                    break;
            }
        }
        let action = actions.renameProject('projectId', 'project name')(dispatch)
    })
})


// Delete projects

describe('actions', () => {
    it('should create an action of type DELETE_PROJECT_REQUEST', () => {
        const expectedAction = {
            type: actions.DELETE_PROJECT_REQUEST,
        }
        expect(actions.deleteProjectRequest().type).toEqual(expectedAction.type)
    })
})

describe('actions', () => {
    it('should create an action of type DELETE_PROJECT_SUCCESS', () => {
        let action = actions.deleteProjectSuccess('projectId')
        expect(action.type).toEqual(actions.DELETE_PROJECT_SUCCESS)
        expect(action.payload).toEqual('projectId')
    })
})

describe('actions', () => {
    it('should create an action of type DELETE_PROJECT_FAILED', () => {
        const expectedAction = {
            type: actions.DELETE_PROJECT_FAILED,
            payload: 'error that occurred'
        }
        let action = actions.deleteProjectError('error that occurred')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions', () => {
    it('should despatch DELETE_PROJECT_FAILED error action', () => {

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.DELETE_PROJECT_REQUEST:
                    expect(dispatched.type).toEqual(actions.DELETE_PROJECT_REQUEST)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.DELETE_PROJECT_FAILED)
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
                    break;
            }
        }
        let action = actions.deleteProject('projectId')(dispatch)
    })
})

describe('actions', () => {
    it('should despatch DELETE_PROJECT_FAILED error action', () => {

        axiosMock.onDelete(`${API_URL}/project/projectId/deleteProject`).reply(200, {
            data: 'renamed project'
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.DELETE_PROJECT_REQUEST:
                    expect(dispatched.type).toEqual(actions.DELETE_PROJECT_REQUEST)
                    break;
                case actions.DELETE_PROJECT_SUCCESS:
                    expect(dispatched.type).toEqual(actions.DELETE_PROJECT_SUCCESS)
                    expect(dispatched.payload).toEqual('projectId')
                    break;
                case 'incident/DELETE_PROJECT_INCIDENTS':
                    expect(dispatched.type).toEqual('incident/DELETE_PROJECT_INCIDENTS')
                    expect(dispatched.payload).toEqual('projectId')
                    break;
                case 'schedule/DELETE_PROJECT_SCHEDULES':
                    expect(dispatched.type).toEqual('schedule/DELETE_PROJECT_SCHEDULES')
                    expect(dispatched.payload).toEqual('projectId')
                    break;
                case 'DELETE_PROJECT_MONITORS':
                    expect(dispatched.type).toEqual('DELETE_PROJECT_MONITORS')
                    expect(dispatched.payload).toEqual('projectId')
                    break;
                case 'incident/DELETE_PROJECT_STATUSPAGES':
                    expect(dispatched.type).toEqual('incident/DELETE_PROJECT_STATUSPAGES')
                    expect(dispatched.payload).toEqual('projectId')
                    break;
                case actions.HIDE_DELETE_MODAL:
                    expect(dispatched.type).toEqual(actions.HIDE_DELETE_MODAL)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.DELETE_PROJECT_FAILED)
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
                    break;
            }
        }
        let action = actions.deleteProject('projectId')(dispatch)
    })
})

// Change plan

describe('actions', () => {
    it('should create an action of type CHANGE_PLAN_RESET', () => {
        const expectedAction = {
            type: actions.CHANGE_PLAN_RESET,
        }
        expect(actions.changePlanReset().type).toEqual(expectedAction.type)
    })
})

describe('actions', () => {
    it('should create an action of type CHANGE_PLAN_REQUEST', () => {
        const expectedAction = {
            type: actions.CHANGE_PLAN_REQUEST,
        }
        expect(actions.changePlanRequest().type).toEqual(expectedAction.type)
    })
})

describe('actions', () => {
    it('should create an action of type CHANGE_PLAN_SUCCESS', () => {
        let action = actions.changePlanSuccess({
            data: 'data'
        })
        expect(action.type).toEqual(actions.CHANGE_PLAN_SUCCESS)
        expect(action.payload).toEqual('data')
    })
})

describe('actions', () => {
    it('should create an action of type CHANGE_PLAN_FAILED', () => {
        const expectedAction = {
            type: actions.CHANGE_PLAN_FAILED,
            payload: 'error that occurred'
        }
        let action = actions.changePlanError('error that occurred')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions', () => {
    it('should despatch CHANGE_PLAN_FAILED error action', () => {

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.CHANGE_PLAN_REQUEST:
                    expect(dispatched.type).toEqual(actions.CHANGE_PLAN_REQUEST)
                    break;
                case actions.CHANGE_PLAN_RESET:
                    expect(dispatched.type).toEqual(actions.CHANGE_PLAN_RESET)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.CHANGE_PLAN_FAILED)
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
                    break;
            }
        }
        let action = actions.changePlan('projectId')(dispatch)
    })
})

describe('actions', () => {
    it('should despatch DELETE_PROJECT_FAILED error action', () => {

        axiosMock.onPost(`${API_URL}/project/projectId/changePlan`).reply(200, {
            data: 'new plan'
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.CHANGE_PLAN_REQUEST:
                    expect(dispatched.type).toEqual(actions.CHANGE_PLAN_REQUEST)
                    break;
                case actions.CHANGE_PLAN_SUCCESS:
                    expect(dispatched.type).toEqual(actions.CHANGE_PLAN_SUCCESS)
                    expect(dispatched.payload).toEqual({"data": "new plan"})
                    break;
                case actions.CHANGE_PLAN_RESET:
                    expect(dispatched.type).toEqual(actions.CHANGE_PLAN_RESET)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.DELETE_PROJECT_FAILED)
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
                    break;
            }
        }
        let action = actions.changePlan('projectId')(dispatch)
    })
})

// Calls the API to delete team member.


describe('actions', () => {
    it('should create an action of type EXIT_PROJECT_REQUEST', () => {
        const expectedAction = {
            type: actions.EXIT_PROJECT_REQUEST,
        }
        expect(actions.exitProjectRequest().type).toEqual(expectedAction.type)
    })
})

describe('actions', () => {
    it('should create an action of type EXIT_PROJECT_SUCCESS', () => {
        let action = actions.exitProjectSuccess('userId')
        expect(action.type).toEqual(actions.EXIT_PROJECT_SUCCESS)
        expect(action.payload).toEqual('userId')
    })
})

describe('actions', () => {
    it('should create an action of type EXIT_PROJECT_FAILED', () => {
        const expectedAction = {
            type: actions.EXIT_PROJECT_FAILED,
            payload: 'error that occurred'
        }
        let action = actions.exitProjectError('error that occurred')
        expect(action.type).toEqual(expectedAction.type)
        expect(action.payload).toEqual(expectedAction.payload)
    })
})

describe('actions', () => {
    it('should despatch CHANGE_PLAN_FAILED error action', () => {

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.EXIT_PROJECT_REQUEST:
                    expect(dispatched.type).toEqual(actions.EXIT_PROJECT_REQUEST)
                    break;
                case actions.EXIT_PROJECT_SUCCESS:
                    expect(dispatched.type).toEqual(actions.EXIT_PROJECT_SUCCESS)
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.EXIT_PROJECT_FAILED)
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
                    break;
            }
        }
        let action = actions.exitProject('projectId', 'userId')(dispatch)
    })
})

describe('actions', () => {
    it('should despatch DELETE_PROJECT_FAILED error action', () => {

        axiosMock.onDelete(`${API_URL}/project/projectId/user/userId/exitProject`).reply(200, {
            data: 'new plan'
        }, {});

        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case actions.EXIT_PROJECT_REQUEST:
                    expect(dispatched.type).toEqual(actions.EXIT_PROJECT_REQUEST)
                    break;
                case actions.EXIT_PROJECT_SUCCESS:
                    expect(dispatched.type).toEqual(actions.EXIT_PROJECT_SUCCESS)
                    expect(dispatched.payload).toEqual( {"projectId": "projectId", "userId": "userId"})
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.EXIT_PROJECT_FAILED)
                    expect(dispatched.payload).toEqual(Error('Request failed with status code 404'))
                    break;
            }
        }
        let action = actions.exitProject('projectId','userId')(dispatch)
    })
})