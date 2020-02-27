import * as actions from '../../actions/socket';

describe('actions', () => {
    it('should create an action of type INCIDENT_RESOLVED_BY_SOCKET', () => {
        const dispatch = dispatched => {
            expect(dispatched.type).toEqual('INCIDENT_RESOLVED_BY_SOCKET');
            expect(dispatched.payload).toEqual({
                data: {
                    data: 'incident',
                },
            });
        };

        actions.incidentresolvedbysocket({
            data: 'incident',
        })(dispatch);
    });
});

describe('actions', () => {
    it('should create an action of type INCIDENT_ACKNOWLEDGED_BY_SOCKET', () => {
        const dispatch = dispatched => {
            expect(dispatched.type).toEqual('INCIDENT_ACKNOWLEDGED_BY_SOCKET');
            expect(dispatched.payload).toEqual({
                data: {
                    data: 'incident',
                },
            });
        };

        actions.incidentacknowledgedbysocket({
            data: 'incident',
        })(dispatch);
    });
});

describe('actions', () => {
    it('should create an action of type CREATE_MONITOR_SUCCESS', () => {
        const dispatch = dispatched => {
            expect(dispatched.type).toEqual('CREATE_MONITOR_SUCCESS');
        };
        actions.createmonitorbysocket()(dispatch);
    });
});

describe('actions', () => {
    it('should create an action of type CREATE_MONITOR_SUCCESS', () => {
        const dispatch = dispatched => {
            switch (dispatched.type) {
                case 'UPDATE_INCIDENTS_MONITOR_NAME':
                    expect(dispatched.type).toEqual(
                        'UPDATE_INCIDENTS_MONITOR_NAME'
                    );
                    break;
                default:
                    expect(dispatched.type).toEqual('EDIT_MONITOR_SUCCESS');
                    break;
            }
        };
        actions.updatemonitorbysocket({
            data: 'monitor',
        })(dispatch);
    });
});

describe('actions', () => {
    it('should create an action of type DELETE_MONITOR_BY_SOCKET', () => {
        const dispatch = dispatched => {
            expect(dispatched.type).toEqual('DELETE_MONITOR_BY_SOCKET');
            expect(dispatched.payload).toEqual('monitorId');
        };
        actions.deletemonitorbysocket({
            _id: 'monitorId',
        })(dispatch);
    });
});

describe('actions', () => {
    it('should create an action of type ADD_NEW_INCIDENT_TO_UNRESOLVED and ADD_NEW_INCIDENT_TO_MONITORS', () => {
        const dispatch = dispatched => {
            switch (dispatched.type) {
                case 'ADD_NEW_INCIDENT_TO_MONITORS':
                    expect(dispatched.type).toEqual(
                        'ADD_NEW_INCIDENT_TO_MONITORS'
                    );
                    expect(dispatched.payload).toEqual({
                        unresolvedincident: {},
                        incident: {},
                    });
                    break;
                default:
                    expect(dispatched.type).toEqual(
                        'ADD_NEW_INCIDENT_TO_UNRESOLVED'
                    );
                    expect(dispatched.payload).toEqual({
                        unresolvedincident: {},
                        incident: {},
                    });
                    break;
            }
        };
        actions.incidentcreatedbysocket({
            unresolvedincident: {},
            incident: {},
        })(dispatch);
    });
});

describe('actions', () => {
    it('should create an action of type ADD_NOTIFICATION_BY_SOCKET', () => {
        const dispatch = dispatched => {
            expect(dispatched.type).toEqual('ADD_NOTIFICATION_BY_SOCKET');
            expect(dispatched.payload).toEqual({});
        };
        actions.addnotifications({})(dispatch);
    });
});

describe('actions', () => {
    it('should create an action of type TEAM_UPDATE_ROLE_SUCCESS and projects/CHANGE_PROJECT_ROLES', () => {
        const dispatch = dispatched => {
            switch (dispatched.type) {
                case 'TEAM_UPDATE_ROLE_SUCCESS':
                    expect(dispatched.type).toEqual('TEAM_UPDATE_ROLE_SUCCESS');
                    expect(dispatched.payload).toEqual({});
                    break;
                default:
                    expect(dispatched.type).toEqual(
                        'projects/CHANGE_PROJECT_ROLES'
                    );
                    expect(dispatched.payload).toEqual({});
                    break;
            }
        };
        actions.teamMemberRoleUpdate({})(dispatch);
    });
});

describe('actions', () => {
    it('should create an action of type TEAM_CREATE_SUCCESS', () => {
        const dispatch = dispatched => {
            expect(dispatched.type).toEqual('TEAM_CREATE_SUCCESS');
            expect(dispatched.payload).toEqual({});
        };
        actions.teamMemberCreate({})(dispatch);
    });
});

describe('actions', () => {
    it('should create an action of type TEAM_DELETE_SUCCESS', () => {
        const dispatch = dispatched => {
            expect(dispatched.type).toEqual('TEAM_DELETE_SUCCESS');
            expect(dispatched.payload).toEqual({});
        };
        actions.teamMemberDelete({})(dispatch);
    });
});
