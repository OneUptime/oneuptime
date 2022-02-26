const createIncident = (z: $TSFixMe, bundle: $TSFixMe) => {
    if (bundle.cleanedRequest) return bundle.cleanedRequest;
    const data = {
        monitors: bundle.inputData.monitors,
    };
    const responsePromise = z.request({
        method: 'POST',
        url: `${bundle.authData.serverUrl}/zapier/incident/createIncident`,
        body: data,
    });
    return responsePromise.then((response: $TSFixMe) => JSON.parse(response.content));
};

export default {
    key: 'incident',
    noun: 'Incident',

    display: {
        label: 'Create Incident',
        description: 'Creates an incident.',
        important: true,
    },

    operation: {
        inputFields: [
            {
                key: 'monitors',
                type: 'string',
                placeholder: 'list of monitors',
                dynamic: 'monitors.id.name',
                altersDynamicFields: true,
                list: true,
                required: true,
            },
        ],
        perform: createIncident,
        sample: {
            projectName: 'New Project',
            projectId: '1',
            incidentId: '1',
            idNumber: '1',
            acknowledged: false,
            resolved: false,
            internalNote: 'New Note',
            investigationNote: 'New Investigation',
            createdAt: new Date().toISOString(),
            createdBy: 'oneuptime',
            monitorName: 'New Sample',
            monitorType: 'url',
            monitorData: 'https://oneuptime.com',
        },
    },
};
