export default {
    incidentRequest: {
        name: 'pyInt',
        selectAllMonitors: true,
        createIncident: true,
        incidentTitle: 'Test Incident',
        incidentType: 'offline',
        incidentDescription:
            'This is a sample incident to test incoming http request',
        filterMatch: 'any',
        filters: [
            {
                filterCondition: 'equalTo',
                filterCriteria: 'monitorField',
                filterText: 'testing',
            },
        ],
        monitors: [],
    },
    acknowledgeRequest: {
        name: 'ack',
        acknowledgeIncident: true,
        filterMatch: 'any',
        filters: [
            {
                filterCondition: 'greaterThanOrEqualTo',
                filterCriteria: 'incidentId',
                filterText: 1,
            },
        ],
    },
    resolveRequest: {
        name: 'resolve',
        resolveIncident: true,
        filterMatch: 'any',
        filters: [
            {
                filterCondition: 'greaterThanOrEqualTo',
                filterCriteria: 'incidentId',
                filterText: 1,
            },
        ],
    },
    incidentNoteRequest: {
        name: 'incidentNote',
        updateIncidentNote: true,
        filterMatch: 'all',
        filters: [
            {
                filterCondition: 'greaterThanOrEqualTo',
                filterCriteria: 'incidentId',
                filterText: 1,
            },
        ],
        incidentState: 'update',
        noteContent: 'This is a sample incident note',
    },
    internalNoteRequest: {
        name: 'internalNote',
        updateInternalNote: true,
        incidentState: 'investigating',
        noteContent: 'This is a sample internal note',
        filterMatch: 'all',
        filters: [
            {
                filterCondition: 'equalTo',
                filterCriteria: 'incidentId',
                filterText: 1,
            },
        ],
    },
};
