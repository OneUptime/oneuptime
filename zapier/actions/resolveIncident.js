const resolveIncident = (z, bundle) => {
    if (bundle.cleanedRequest) return bundle.cleanedRequest;
    const data = {
        incidents: bundle.inputData.incidents,
    };
    const responsePromise = z.request({
        method: 'POST',
        url: 'https://api.fyipe.com/zapier/incident/resolveIncident',
        body: data,
    });
    return responsePromise.then(response => JSON.parse(response.content));
};

module.exports = {
    key: 'resolve_incident',
    noun: 'Resolve',

    display: {
        label: 'Resolve Incident',
        description: 'Resolves incident.',
        important: true,
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
        perform: resolveIncident,
        sample: {
            projectName: 'New Project',
            projectId: '1',
            incidentId: '1',
            resolved: true,
            internalNote: 'New Note',
            investigationNote: 'New Investigation',
            createdAt: new Date().toISOString(),
            createdBy: 'fyipe',
            resolvedAt: new Date().toISOString(),
            resolvedBy: 'fyipe',
            monitorName: 'New Sample',
            monitorType: 'url',
            monitorData: 'https://fyipe.com',
        },
    },
};
