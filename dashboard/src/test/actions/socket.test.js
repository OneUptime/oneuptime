import * as actions from '../../actions/socket'
import axiosMock from '../axios_mock'
import {
    API_URL
} from '../../config'

describe('actions', () => {
    it('should create an action of type INCIDENT_RESOLVED_BY_SOCKET', () => {
        let dispatch = (dispatched) => {
            expect(dispatched.type).toEqual('INCIDENT_RESOLVED_BY_SOCKET')
            expect(dispatched.payload).toEqual({
                data: {
                    data: 'incident'
                }
            })
        }

        let action = actions.incidentresolvedbysocket({
            data: 'incident'
        })(dispatch)
    })
})

describe('actions', () => {
    it('should create an action of type INCIDENT_ACKNOWLEDGED_BY_SOCKET', () => {
        let dispatch = (dispatched) => {
            expect(dispatched.type).toEqual('INCIDENT_ACKNOWLEDGED_BY_SOCKET')
            expect(dispatched.payload).toEqual({
                data: {
                    data: 'incident'
                }
            })
        }

        let action = actions.incidentacknowledgedbysocket({
            data: 'incident'
        })(dispatch)
    })
})

describe('actions', () => {
    it('should create an action of type CREATE_MONITOR_SUCCESS', () => {
        let dispatch = (dispatched) => {
            expect(dispatched.type).toEqual('CREATE_MONITOR_SUCCESS')
        }
        let action = actions.createmonitorbysocket()(dispatch)
    })
})

describe('actions', () => {
    it('should create an action of type CREATE_MONITOR_SUCCESS', () => {
        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case 'UPDATE_INCIDENTS_MONITOR_NAME':
                    expect(dispatched.type).toEqual('UPDATE_INCIDENTS_MONITOR_NAME')
                    break;
                default:
                    expect(dispatched.type).toEqual('EDIT_MONITOR_SUCCESS')
                    break;
            }
        }
        let action = actions.updatemonitorbysocket({
            data: 'monitor'
        })(dispatch)
    })
})

describe('actions', () => {
    it('should create an action of type DELETE_MONITOR_BY_SOCKET', () => {
        let dispatch = (dispatched) => {
            expect(dispatched.type).toEqual('DELETE_MONITOR_BY_SOCKET')
            expect(dispatched.payload).toEqual('monitorId')
        }
        let action = actions.deletemonitorbysocket({
            _id: 'monitorId'
        })(dispatch)
    })
})

describe('actions', () => {
    it('should create an action of type ADD_NEW_INCIDENT_TO_UNRESOLVED and ADD_NEW_INCIDENT_TO_MONITORS', () => {
        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case 'ADD_NEW_INCIDENT_TO_MONITORS':
                    expect(dispatched.type).toEqual('ADD_NEW_INCIDENT_TO_MONITORS')
                    expect(dispatched.payload).toEqual({unresolvedincident: {},incident:{}})
                    break;
                default:
                    expect(dispatched.type).toEqual('ADD_NEW_INCIDENT_TO_UNRESOLVED')
                    expect(dispatched.payload).toEqual({unresolvedincident: {},incident:{}})
                    break;
            }
        }
        let action = actions.incidentcreatedbysocket({
            unresolvedincident: {},
            incident:{}
        })(dispatch)
    })
})

describe('actions', () => {
    it('should create an action of type ADD_NOTIFICATION_BY_SOCKET', () => {
        let dispatch = (dispatched) => {
            expect(dispatched.type).toEqual('ADD_NOTIFICATION_BY_SOCKET')
            expect(dispatched.payload).toEqual({})
        }
        let action = actions.addnotifications({})(dispatch)
    })
})

describe('actions', () => {
    it('should create an action of type TEAM_UPDATE_ROLE_SUCCESS and projects/CHANGE_PROJECT_ROLES', () => {
        let dispatch = (dispatched) => {
            switch (dispatched.type) {
                case 'TEAM_UPDATE_ROLE_SUCCESS':
                    expect(dispatched.type).toEqual('TEAM_UPDATE_ROLE_SUCCESS')
                    expect(dispatched.payload).toEqual({})
                    break;
                default:
                    expect(dispatched.type).toEqual('projects/CHANGE_PROJECT_ROLES')
                    expect(dispatched.payload).toEqual({})
                    break;
            }
        }
        let action = actions.teamMemberRoleUpdate({})(dispatch)
    })
})

describe('actions', () => {
    it('should create an action of type TEAM_CREATE_SUCCESS', () => {
        let dispatch = (dispatched) => {
            expect(dispatched.type).toEqual('TEAM_CREATE_SUCCESS')
            expect(dispatched.payload).toEqual({})
        }
        let action = actions.teamMemberCreate({})(dispatch)
    })
})

describe('actions', () => {
    it('should create an action of type TEAM_DELETE_SUCCESS', () => {
        let dispatch = (dispatched) => {
            expect(dispatched.type).toEqual('TEAM_DELETE_SUCCESS')
            expect(dispatched.payload).toEqual({})
        }
        let action = actions.teamMemberDelete({})(dispatch)
    })
})