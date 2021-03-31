const createIncidentNote = (z, bundle) => {
    if (bundle.cleanedRequest) return bundle.cleanedRequest;
    const data = {
        data: bundle.inputData,
    };
    const responsePromise = z.request({
        method: 'POST',
        url: `${bundle.authData.serverUrl}/zapier/incident/incident-note`,
        body: data,
    });
    return responsePromise.then(response => JSON.parse(response.content));
};

module.exports = {
    key: 'incident_note',
    noun: 'Incident Note',

    display: {
        label: 'Create Incident Note',
        description: 'Creates an incident Note.',
        important: false,
    },

    operation: {
        inputFields: [
            {
                key: 'incidents',
                type: 'string',
                placeholder: 'list of incidents',
                dynamic: 'incidents.id',
                altersDynamicFields: true,
                list: true,
                required: true,
            },
        ],
        perform: createIncidentNote,
        sample: {
            projectName: 'New Project',
            projectId: '1',
            incidentId: '1',
            id: '1',
            content: 'new incidentNote',
            incident_state: 'update',
            type: 'investigation',
            createdAt: new Date().toISOString(),
            createdBy: 'Nawaz',
        },
    },
};
