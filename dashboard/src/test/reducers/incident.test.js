import reducer from '../../reducers/incident';
import * as types from '../../constants/incident';

const initialState = {
    incidents: {
        requesting: false,
        error: null,
        success: false,
        incidents: [],
        count: null,
        limit: null,
        skip: null,
    },
    newIncident: {
        requesting: false,
        success: false,
    },
    incident: {
        requesting: false,
        error: null,
        success: false,
        incident: null,
    },
    investigationNotes: {
        requesting: false,
        error: null,
        success: false,
    },
    internalNotes: {
        requesting: false,
        error: null,
        success: false,
    },
    unresolvedincidents: {
        requesting: false,
        error: null,
        success: false,
        incidents: [],
    },
};

describe('Incident Reducers', () => {
    it('should handle initial state', () => {
        expect(reducer(initialState, {})).toEqual(initialState);
    });

    it('should return INCIDENTS_SUCCESS', () => {
        const payload = {
            requesting: false,
            error: null,
            success: true,
            data: [],
            count: 20,
            limit: 50,
            skip: 5,
        };
        const test = {
            incidents: {
                requesting: false,
                error: null,
                success: true,
                incidents: [],
                count: 20,
                limit: 50,
                skip: 5,
            },
        };
        expect(
            reducer(initialState, {
                type: types.INCIDENTS_SUCCESS,
                payload: payload,
            }).incidents
        ).toEqual(test.incidents);
    });

    it('should handle INCIDENTS_REQUEST', () => {
        const test = {
            incidents: {
                requesting: true,
                success: false,
                error: null,
                count: null,
                limit: null,
                skip: null,
            },
        };
        expect(
            reducer(initialState, { type: types.INCIDENTS_REQUEST }).incidents
        ).toEqual(test.incidents);
    });

    it('should handle INCIDENTS_FAILED', () => {
        const test = {
            incidents: {
                incidents: [],
                requesting: false,
                success: false,
                error: 'error that will occur',
                count: null,
                limit: null,
                skip: null,
            },
        };
        expect(
            reducer(initialState, {
                type: types.INCIDENTS_FAILED,
                payload: 'error that will occur',
            }).incidents
        ).toEqual(test.incidents);
    });

    it('should handle INCIDENTS_RESET', () => {
        const test = {
            incidents: {
                requesting: false,
                error: null,
                success: false,
                incidents: [],
                count: null,
                limit: null,
                skip: null,
            },
        };
        expect(
            reducer(initialState, { type: types.INCIDENTS_RESET }).incidents
        ).toEqual(test.incidents);
    });

    it('should handle CREATE_INCIDENT_RESET', () => {
        const test = {
            newIncident: {
                requesting: false,
                error: null,
                success: false,
            },
        };
        expect(
            reducer(initialState, { type: types.CREATE_INCIDENT_RESET })
                .newIncident
        ).toEqual(test.newIncident);
    });

    it('should handle CREATE_INCIDENT_RESET', () => {
        const test = {
            newIncident: {
                requesting: false,
                error: null,
                success: false,
            },
        };
        expect(
            reducer(initialState, { type: types.CREATE_INCIDENT_RESET })
                .newIncident
        ).toEqual(test.newIncident);
    });

    it('should handle CREATE_INCIDENT_SUCCESS', () => {
        const test = {
            newIncident: {
                requesting: false,
                error: null,
                success: false,
            },
            incidents: {
                ...initialState.incidents,
                incidents: [[{ _id: 'test' }]],
            },
        };
        expect(
            reducer(initialState, { type: types.CREATE_INCIDENT_SUCCESS })
                .newIncident
        ).toEqual(test.newIncident);
        expect(
            reducer(initialState, {
                type: types.CREATE_INCIDENT_SUCCESS,
                payload: [{ _id: 'test' }],
            }).incidents
        ).toEqual(test.incidents);
    });

    // TODO:  This action is not being handled well
    it('should handle CREATE_INCIDENT_REQUEST, handle CREATE_INCIDENT_SUCCESS Instead ', () => {
        const test = {
            newIncident: {
                requesting: true,
                success: false,
                error: null,
            },
        };
        expect(
            reducer(initialState, { type: types.CREATE_INCIDENT_REQUEST })
                .newIncident
        ).toEqual(test.newIncident);
    });

    it('should handle CREATE_INCIDENT_FAILED', () => {
        const test = {
            newIncident: {
                requesting: false,
                success: false,
                error: 'error that will occur CREATE_INCIDENT_FAILED',
            },
        };
        expect(
            reducer(initialState, {
                type: types.CREATE_INCIDENT_FAILED,
                payload: 'error that will occur CREATE_INCIDENT_FAILED',
            }).newIncident
        ).toEqual(test.newIncident);
    });

    it('should handle INCIDENT_SUCCESS', () => {
        const test = {
            incident: {
                requesting: false,
                error: null,
                success: true,
                incident: [{ _id: 'test incident INCIDENT_SUCCESS' }],
            },
        };
        expect(
            reducer(initialState, {
                type: types.INCIDENT_SUCCESS,
                payload: [{ _id: 'test incident INCIDENT_SUCCESS' }],
            }).incident
        ).toEqual(test.incident);
    });

    it('should handle INCIDENT_REQUEST', () => {
        const test = {
            incident: {
                requesting: true,
                success: false,
                error: null,
                incident: null,
            },
        };
        expect(
            reducer(initialState, { type: types.INCIDENT_REQUEST }).incident
        ).toEqual(test.incident);
    });

    it('should handle INCIDENT_FAILED', () => {
        const test = {
            incident: {
                requesting: false,
                error: 'error that will occur INCIDENT_FAILED',
                success: false,
                incident: [],
            },
        };
        expect(
            reducer(initialState, {
                type: types.INCIDENT_FAILED,
                payload: { error: 'error that will occur INCIDENT_FAILED' },
            }).incident
        ).toEqual(test.incident);
    });

    it('should handle INCIDENT_FAILED, multiple', () => {
        const test = {
            unresolvedincidents: {
                requesting: false,
                success: false,
                error: 'error that will occur INCIDENT_FAILED',
                incidents: [],
            },
        };
        expect(
            reducer(initialState, {
                type: types.INCIDENT_FAILED,
                payload: {
                    error: 'error that will occur INCIDENT_FAILED',
                    multiple: true,
                },
            }).unresolvedincidents
        ).toEqual(test.unresolvedincidents);
    });

    it('should handle INCIDENT_RESET', () => {
        const test = {
            incident: {
                requesting: false,
                error: null,
                success: false,
                incident: null,
            },
        };
        expect(
            reducer(initialState, { type: types.INCIDENT_RESET }).incident
        ).toEqual(test.incident);
    });

    it('should handle ACKNOWLEDGE_INCIDENT_SUCCESS', () => {
        const test = {
            incident: {
                requesting: false,
                error: null,
                success: true,
                incident: [{ _id: 'test ACKNOWLEDGE_INCIDENT_SUCCESS' }],
            },
        };
        expect(
            reducer(initialState, {
                type: types.ACKNOWLEDGE_INCIDENT_SUCCESS,
                payload: {
                    data: [{ _id: 'test ACKNOWLEDGE_INCIDENT_SUCCESS' }],
                },
            }).incident
        ).toEqual(test.incident);
    });

    it('should handle ACKNOWLEDGE_INCIDENT_SUCCESS, multiple , return incident in payload', () => {
        initialState.unresolvedincidents.incidents = [
            { _id: 'test ACKNOWLEDGE_INCIDENT_SUCCESS' },
        ];
        const with_incident = {
            unresolvedincidents: {
                requesting: false,
                error: null,
                success: true,
                incidents: [
                    {
                        _id: 'test ACKNOWLEDGE_INCIDENT_SUCCESS',
                        from: 'payload',
                    },
                ],
            },
        };
        expect(
            reducer(initialState, {
                type: types.ACKNOWLEDGE_INCIDENT_SUCCESS,
                payload: {
                    data: {
                        _id: 'test ACKNOWLEDGE_INCIDENT_SUCCESS',
                        from: 'payload',
                    },
                    multiple: true,
                },
            }).unresolvedincidents
        ).toEqual(with_incident.unresolvedincidents);
    });

    it('should handle ACKNOWLEDGE_INCIDENT_SUCCESS, multiple , return incident from state', () => {
        const with_no_incident = {
            unresolvedincidents: {
                requesting: false,
                error: null,
                success: true,
                incidents: [{ _id: 'test ACKNOWLEDGE_INCIDENT_SUCCESS' }],
            },
        };
        initialState.unresolvedincidents.incidents = [
            { _id: 'test ACKNOWLEDGE_INCIDENT_SUCCESS' },
        ];
        expect(
            reducer(initialState, {
                type: types.ACKNOWLEDGE_INCIDENT_SUCCESS,
                payload: {
                    data: {
                        _id: '_test ACKNOWLEDGE_INCIDENT_SUCCESS',
                        from: 'payload',
                    },
                    multiple: true,
                },
            }).unresolvedincidents
        ).toEqual(with_no_incident.unresolvedincidents);
        initialState.unresolvedincidents.incidents = [];
    });

    it('should handle RESOLVE_INCIDENT_SUCCESS', () => {
        const test = {
            incident: {
                requesting: false,
                error: null,
                success: true,
                incident: { _id: '_test RESOLVE_INCIDENT_SUCCESS' },
            },
        };
        expect(
            reducer(initialState, {
                type: types.RESOLVE_INCIDENT_SUCCESS,
                payload: { data: { _id: '_test RESOLVE_INCIDENT_SUCCESS' } },
            }).incident
        ).toEqual(test.incident);
    });

    it('should handle RESOLVE_INCIDENT_SUCCESS, multiple , return filtered to []', () => {
        initialState.unresolvedincidents.incidents = [
            { _id: 'test RESOLVE_INCIDENT_SUCCESS' },
        ];
        const with_incident = {
            unresolvedincidents: {
                requesting: false,
                error: null,
                success: true,
                incidents: [{ _id: 'test RESOLVE_INCIDENT_SUCCESS' }],
            },
        };
        expect(
            reducer(initialState, {
                type: types.RESOLVE_INCIDENT_SUCCESS,
                payload: {
                    data: { _id: 'test RESOLVE_INCIDENT_SUCCESS' },
                    multiple: true,
                },
            }).unresolvedincidents
        ).toEqual(with_incident.unresolvedincidents);
    });

    it('should handle RESOLVE_INCIDENT_SUCCESS, multiple , with_no_incident', () => {
        const with_no_incident = {
            unresolvedincidents: {
                requesting: false,
                error: null,
                success: true,
                incidents: [{ _id: 'test RESOLVE_INCIDENT_SUCCESS' }],
            },
        };

        expect(
            reducer(initialState, {
                type: types.RESOLVE_INCIDENT_SUCCESS,
                payload: {
                    data: { _id: '_test RESOLVE_INCIDENT_SUCCESS' },
                    multiple: true,
                },
            }).unresolvedincidents
        ).toEqual(with_no_incident.unresolvedincidents);
    });

    it('should handle ACKNOWLEDGE_INCIDENT_REQUEST', () => {
        initialState.unresolvedincidents.incidents = [];
        const test = {
            unresolvedincidents: {
                incidents: [],
                requesting: false,
                error: null,
                success: false,
            },
        };
        expect(
            reducer(initialState, {
                type: types.ACKNOWLEDGE_INCIDENT_REQUEST,
                payload: {
                    data: [{ _id: 'test ACKNOWLEDGE_INCIDENT_REQUEST' }],
                },
            }).unresolvedincidents
        ).toEqual(test.unresolvedincidents);
    });

    it('should handle ACKNOWLEDGE_INCIDENT_REQUEST, multiple , with_no_incident', () => {
        const with_no_incident = {
            unresolvedincidents: {
                requesting: true,
                error: null,
                success: false,
                incidents: [{ _id: 'test ACKNOWLEDGE_INCIDENT_REQUEST' }],
            },
        };
        initialState.unresolvedincidents.incidents = [
            { _id: 'test ACKNOWLEDGE_INCIDENT_REQUEST' },
        ];
        expect(
            reducer(initialState, {
                type: types.ACKNOWLEDGE_INCIDENT_REQUEST,
                payload: {
                    data: { _id: 'test ACKNOWLEDGE_INCIDENT_REQUEST' },
                    multiple: true,
                },
            }).unresolvedincidents
        ).toEqual(with_no_incident.unresolvedincidents);
        initialState.unresolvedincidents.incidents = [];
    });

    it('should handle RESOLVE_INCIDENT_REQUEST', () => {
        const test = {
            incident: {
                incident: null,
                requesting: true,
                error: null,
                success: false,
            },
        };
        expect(
            reducer(initialState, {
                type: types.RESOLVE_INCIDENT_REQUEST,
                payload: { data: { _id: 'test RESOLVE_INCIDENT_REQUEST' } },
            }).incident
        ).toEqual(test.incident);
    });

    it('should handle RESOLVE_INCIDENT_REQUEST, multiple , with_no_incident', () => {
        const with_no_incident = {
            unresolvedincidents: {
                requesting: true,
                error: null,
                success: false,
                incidents: [{ _id: 'test RESOLVE_INCIDENT_REQUEST' }],
            },
        };
        initialState.unresolvedincidents.incidents = [
            { _id: 'test RESOLVE_INCIDENT_REQUEST' },
        ];
        expect(
            reducer(initialState, {
                type: types.RESOLVE_INCIDENT_REQUEST,
                payload: {
                    data: { _id: 'test RESOLVE_INCIDENT_REQUEST' },
                    multiple: true,
                },
            }).unresolvedincidents
        ).toEqual(with_no_incident.unresolvedincidents);
        initialState.unresolvedincidents.incidents = [];
    });

    it('should handle UNRESOLVED_INCIDENTS_SUCCESS', () => {
        const test = {
            unresolvedincidents: {
                requesting: false,
                error: null,
                success: true,
                incidents: [{ _id: 'test UNRESOLVED_INCIDENTS_SUCCESS' }],
            },
        };
        expect(
            reducer(initialState, {
                type: types.UNRESOLVED_INCIDENTS_SUCCESS,
                payload: [{ _id: 'test UNRESOLVED_INCIDENTS_SUCCESS' }],
            }).unresolvedincidents
        ).toEqual(test.unresolvedincidents);
    });

    it('should handle UNRESOLVED_INCIDENTS_REQUEST', () => {
        const test = {
            unresolvedincidents: {
                requesting: true,
                success: false,
                error: null,
                incidents: null,
            },
        };
        expect(
            reducer(initialState, { type: types.UNRESOLVED_INCIDENTS_REQUEST })
                .unresolvedincidents
        ).toEqual(test.unresolvedincidents);
    });

    it('should handle UNRESOLVED_INCIDENTS_FAILED', () => {
        const test = {
            unresolvedincidents: {
                requesting: false,
                success: false,
                error: 'error UNRESOLVED_INCIDENTS_FAILED',
                incidents: [],
            },
        };
        expect(
            reducer(initialState, {
                type: types.UNRESOLVED_INCIDENTS_FAILED,
                payload: 'error UNRESOLVED_INCIDENTS_FAILED',
            }).unresolvedincidents
        ).toEqual(test.unresolvedincidents);
    });

    it('should handle UNRESOLVED_INCIDENTS_RESET', () => {
        const test = {
            unresolvedincidents: {
                requesting: false,
                success: false,
                error: null,
                incidents: [],
            },
        };
        expect(
            reducer(initialState, { type: types.UNRESOLVED_INCIDENTS_RESET })
                .unresolvedincidents
        ).toEqual(test.unresolvedincidents);
    });

    it('should handle DELETE_PROJECT_INCIDENTS', () => {
        const test = {
            incidents: {
                requesting: false,
                error: null,
                success: false,
                incidents: [],
                count: null,
                limit: null,
                skip: null,
            },
        };
        expect(
            reducer(initialState, { type: types.DELETE_PROJECT_INCIDENTS })
                .incidents
        ).toEqual(test.incidents);
    });

    it('should handle INTERNAL_NOTE_SUCCESS', () => {
        const test = {
            incident: {
                ...initialState.incident,
                incident: { _id: 'test INTERNAL_NOTE_SUCCESS' },
            },
            internalNotes: {
                requesting: false,
                success: true,
                error: null,
            },
        };
        expect(
            reducer(initialState, {
                type: types.INTERNAL_NOTE_SUCCESS,
                payload: { _id: 'test INTERNAL_NOTE_SUCCESS' },
            }).incident
        ).toEqual(test.incident);
        expect(
            reducer(initialState, {
                type: types.INTERNAL_NOTE_SUCCESS,
                payload: { _id: 'test INTERNAL_NOTE_SUCCESS' },
            }).internalNotes
        ).toEqual(test.internalNotes);
    });

    it('should handle INTERNAL_NOTE_REQUEST', () => {
        const test = {
            internalNotes: {
                requesting: true,
                success: false,
                error: null,
            },
        };
        expect(
            reducer(initialState, { type: types.INTERNAL_NOTE_REQUEST })
                .internalNotes
        ).toEqual(test.internalNotes);
    });

    it('should handle INTERNAL_NOTE_FAILED', () => {
        const test = {
            internalNotes: {
                requesting: false,
                success: false,
                error: 'error INTERNAL_NOTE_FAILED',
            },
        };
        expect(
            reducer(initialState, {
                type: types.INTERNAL_NOTE_FAILED,
                payload: 'error INTERNAL_NOTE_FAILED',
            }).internalNotes
        ).toEqual(test.internalNotes);
    });

    it('should handle INVESTIGATION_NOTE_SUCCESS', () => {
        const test = {
            incident: {
                ...initialState.incident,
                incident: { _id: 'id INVESTIGATION_NOTE_SUCCESS' },
            },
            investigationNotes: {
                requesting: false,
                success: true,
                error: null,
            },
        };
        expect(
            reducer(initialState, {
                type: types.INVESTIGATION_NOTE_SUCCESS,
                payload: { _id: 'id INVESTIGATION_NOTE_SUCCESS' },
            }).incident
        ).toEqual(test.incident);
        expect(
            reducer(initialState, {
                type: types.INVESTIGATION_NOTE_SUCCESS,
                payload: { _id: 'id INVESTIGATION_NOTE_SUCCESS' },
            }).investigationNotes
        ).toEqual(test.investigationNotes);
    });

    it('should handle INVESTIGATION_NOTE_REQUEST', () => {
        const test = {
            investigationNotes: {
                requesting: true,
                success: false,
                error: null,
            },
        };
        expect(
            reducer(initialState, { type: types.INVESTIGATION_NOTE_REQUEST })
                .investigationNotes
        ).toEqual(test.investigationNotes);
    });

    it('should handle INVESTIGATION_NOTE_FAILED', () => {
        const test = {
            investigationNotes: {
                requesting: false,
                success: false,
                error: 'error INVESTIGATION_NOTE_FAILED',
            },
        };
        expect(
            reducer(initialState, {
                type: types.INVESTIGATION_NOTE_FAILED,
                payload: 'error INVESTIGATION_NOTE_FAILED',
            }).investigationNotes
        ).toEqual(test.investigationNotes);
    });

    it('should handle INCIDENT_RESOLVED_BY_SOCKET', () => {
        const payload = {
            data: { _id: 'id INCIDENT_RESOLVED_BY_SOCKET', from: 'payload' },
        };
        initialState.unresolvedincidents.incidents = [
            { _id: 'id INCIDENT_RESOLVED_BY_SOCKET' },
        ];
        initialState.incident.incident = {
            _id: 'id INCIDENT_RESOLVED_BY_SOCKET',
            from: 'state',
        };
        const test = {
            unresolvedincidents: {
                requesting: false,
                error: null,
                success: true,
                incidents: [
                    { _id: 'id INCIDENT_RESOLVED_BY_SOCKET', from: 'payload' },
                ],
            },
            incident: {
                requesting: false,
                error: null,
                success: true,
                incident: {
                    _id: 'id INCIDENT_RESOLVED_BY_SOCKET',
                    from: 'payload',
                },
            },
        };

        expect(
            reducer(initialState, {
                type: 'INCIDENT_RESOLVED_BY_SOCKET',
                payload: payload,
            }).unresolvedincidents
        ).toEqual(test.unresolvedincidents);
        expect(
            reducer(initialState, {
                type: 'INCIDENT_RESOLVED_BY_SOCKET',
                payload: payload,
            }).incident
        ).toEqual(test.incident);
    });

    it('should handle INCIDENT_RESOLVED_BY_SOCKET', () => {
        const payload = { data: { _id: '_id INCIDENT_RESOLVED_BY_SOCKET' } };
        initialState.unresolvedincidents.incidents = [
            { _id: 'id INCIDENT_RESOLVED_BY_SOCKET', from: 'state' },
        ];
        const test = {
            unresolvedincidents: {
                requesting: false,
                error: null,
                success: true,
                incidents: [
                    { _id: 'id INCIDENT_RESOLVED_BY_SOCKET', from: 'state' },
                ],
            },
            incident: {
                requesting: false,
                error: null,
                success: true,
                incident: {
                    _id: 'id INCIDENT_RESOLVED_BY_SOCKET',
                    from: 'state',
                },
            },
        };

        expect(
            reducer(initialState, {
                type: 'INCIDENT_RESOLVED_BY_SOCKET',
                payload: payload,
            }).unresolvedincidents
        ).toEqual(test.unresolvedincidents);
        expect(
            reducer(initialState, {
                type: 'INCIDENT_RESOLVED_BY_SOCKET',
                payload: payload,
            }).incident
        ).toEqual(test.incident);
    });

    // INCIDENT_ACKNOWLEDGED_BY_SOCKET

    it('should handle INCIDENT_ACKNOWLEDGED_BY_SOCKET , return initial state.unresolvedincidents.incidents', () => {
        const payload = { data: { _id: 'id INCIDENT_ACKNOWLEDGED_BY_SOCKET' } };
        initialState.unresolvedincidents.incidents = [
            { _id: 'id INCIDENT_ACKNOWLEDGED_BY_SOCKET' },
        ];
        initialState.incident.incident = {
            _id: 'id INCIDENT_ACKNOWLEDGED_BY_SOCKET',
        };
        const test = {
            unresolvedincidents: {
                requesting: false,
                error: null,
                success: true,
                incidents: [{ _id: 'id INCIDENT_ACKNOWLEDGED_BY_SOCKET' }],
            },
            incident: {
                requesting: false,
                error: null,
                success: true,
                incident: { _id: 'id INCIDENT_ACKNOWLEDGED_BY_SOCKET' },
            },
        };
        expect(
            reducer(initialState, {
                type: 'INCIDENT_ACKNOWLEDGED_BY_SOCKET',
                payload: payload,
            }).unresolvedincidents
        ).toEqual(test.unresolvedincidents);
        expect(
            reducer(initialState, {
                type: 'INCIDENT_ACKNOWLEDGED_BY_SOCKET',
                payload: payload,
            }).incident
        ).toEqual(test.incident);
    });

    it('should handle INCIDENT_ACKNOWLEDGED_BY_SOCKET, return payload in state.unresolvedincidents.incidents', () => {
        const payload = {
            data: {
                _id: '_id INCIDENT_ACKNOWLEDGED_BY_SOCKET',
                from: 'payload',
            },
        };
        initialState.unresolvedincidents.incidents = [
            { _id: 'id INCIDENT_ACKNOWLEDGED_BY_SOCKET' },
        ];
        initialState.incident.incident = {
            _id: 'id INCIDENT_ACKNOWLEDGED_BY_SOCKET',
        };
        const test = {
            unresolvedincidents: {
                requesting: false,
                error: null,
                success: true,
                incidents: [{ _id: 'id INCIDENT_ACKNOWLEDGED_BY_SOCKET' }],
            },
            incident: {
                requesting: false,
                error: null,
                success: true,
                incident: { _id: 'id INCIDENT_ACKNOWLEDGED_BY_SOCKET' },
            },
        };
        expect(
            reducer(initialState, {
                type: 'INCIDENT_ACKNOWLEDGED_BY_SOCKET',
                payload: payload,
            }).unresolvedincidents
        ).toEqual(test.unresolvedincidents);
        expect(
            reducer(initialState, {
                type: 'INCIDENT_ACKNOWLEDGED_BY_SOCKET',
                payload: payload,
            }).incident
        ).toEqual(test.incident);
    });

    // DELETE_MONITOR_BY_SOCKET
    it('should handle DELETE_MONITOR_BY_SOCKET with empty state.unresolvedincidents.incidents', () => {
        initialState.unresolvedincidents.incidents = [
            {
                _id: 'id DELETE_MONITOR_BY_SOCKET',
                monitorId: { _id: 'id_ DELETE_MONITOR_BY_SOCKET' },
            },
        ];
        const test = {
            unresolvedincidents: {
                requesting: false,
                error: null,
                success: false,
                incidents: [],
            },
        };
        expect(
            reducer(initialState, {
                type: 'DELETE_MONITOR_BY_SOCKET',
                payload: 'id_ DELETE_MONITOR_BY_SOCKET',
            }).unresolvedincidents
        ).toEqual(test.unresolvedincidents);
    });
    it('should handle DELETE_MONITOR_BY_SOCKET', () => {
        initialState.unresolvedincidents.incidents = [
            {
                _id: 'id DELETE_MONITOR_BY_SOCKET',
                monitorId: { _id: 'id_ DELETE_MONITOR_BY_SOCKET' },
            },
        ];
        const test = {
            unresolvedincidents: {
                requesting: false,
                error: null,
                success: false,
                incidents: initialState.unresolvedincidents.incidents,
            },
        };
        expect(
            reducer(initialState, {
                type: 'DELETE_MONITOR_BY_SOCKET',
                payload: 'id DELETE_MONITOR_BY_SOCKET',
            }).unresolvedincidents
        ).toEqual(test.unresolvedincidents);
    });

    //ADD_NEW_INCIDENT_TO_UNRESOLVED

    it('should handle ADD_NEW_INCIDENT_TO_UNRESOLVED', () => {
        const test = {
            unresolvedincidents: {
                requesting: false,
                error: null,
                success: false,
                incidents: [
                    { _id: 'id ADD_NEW_INCIDENT_TO_UNRESOLVED' },
                ].concat(initialState.unresolvedincidents.incidents),
            },
        };
        expect(
            reducer(initialState, {
                type: 'ADD_NEW_INCIDENT_TO_UNRESOLVED',
                payload: { _id: 'id ADD_NEW_INCIDENT_TO_UNRESOLVED' },
            }).unresolvedincidents
        ).toEqual(test.unresolvedincidents);
    });

    //UPDATE_INCIDENTS_MONITOR_NAME

    it('should handle UPDATE_INCIDENTS_MONITOR_NAME, return state.unresolvedincidents.incidents', () => {
        initialState.unresolvedincidents.incidents = [
            {
                _id: 'id UPDATE_INCIDENTS_MONITOR_NAME',
                monitorId: { _id: 'id UPDATE_INCIDENTS_MONITOR_NAME' },
            },
        ];
        const test = {
            unresolvedincidents: {
                requesting: false,
                error: null,
                success: false,
                incidents: initialState.unresolvedincidents.incidents,
            },
        };
        expect(
            reducer(initialState, {
                type: 'UPDATE_INCIDENTS_MONITOR_NAME',
                payload: {
                    _id: 'id _ UPDATE_INCIDENTS_MONITOR_NAME',
                    name: 'test NAME',
                },
            }).unresolvedincidents
        ).toEqual(test.unresolvedincidents);
    });

    it('should handle UPDATE_INCIDENTS_MONITOR_NAME adds name to monitor in state.unresolvedincidents.incidents', () => {
        initialState.unresolvedincidents.incidents = [
            {
                _id: 'id UPDATE_INCIDENTS_MONITOR_NAME',
                monitorId: {
                    _id: 'id UPDATE_INCIDENTS_MONITOR_NAME',
                    name: 'test NAME',
                },
            },
        ];
        const test = {
            unresolvedincidents: {
                requesting: false,
                error: null,
                success: false,
                incidents: initialState.unresolvedincidents.incidents,
            },
        };
        expect(
            reducer(initialState, {
                type: 'UPDATE_INCIDENTS_MONITOR_NAME',
                payload: {
                    _id: 'id UPDATE_INCIDENTS_MONITOR_NAME',
                    name: 'test NAME',
                },
            }).unresolvedincidents
        ).toEqual(test.unresolvedincidents);
    });
});
