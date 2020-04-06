const acknowledgeIncident = (z, bundle) => {
    if (bundle.cleanedRequest) return bundle.cleanedRequest;
    const data = {
        incidents: bundle.inputData.incidents,
    };
    const responsePromise = z.request({
        method: 'POST',
        url: 'https://fyipe.com/api/zapier/incident/acknowledgeIncident',
        body: data,
    });
    return responsePromise.then(response => JSON.parse(response.content));
};

module.exports = {
    key: 'acknowledge_incident',
    noun: 'Acknowledge',

    display: {
        label: 'Acknowledge Incident',
        description: 'Acknowledges incident.',
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
        perform: acknowledgeIncident,
        sample: {
            projectName: 'New Project',
            projectId: '1',
            incidentId: '1',
            acknowledged: true,
            resolved: false,
            internalNote: 'New Note',
            investigationNote: 'New Investigation',
            createdAt: new Date().toISOString(),
            createdBy: 'fyipe',
            acknowledgedAt: new Date().toISOString(),
            acknowledgedBy: 'fyipe',
            monitorName: 'New Sample',
            monitorType: 'url',
            monitorData: 'https://fyipe.com',
        },
    },
};
