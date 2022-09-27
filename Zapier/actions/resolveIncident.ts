const resolveIncident: Function = (z: $TSFixMe, bundle: $TSFixMe): void => {
    if (bundle.cleanedRequest) {
        return bundle.cleanedRequest;
    }
    const data: $TSFixMe = {
        incidents: bundle.inputData.incidents,
    };
    const responsePromise: $TSFixMe = z.request({
        method: 'POST',
        url: `${bundle.authData.serverUrl}/zapier/incident/resolveIncident`,
        body: data,
    });
    return responsePromise.then((response: $TSFixMe) => {
        return JSON.parse(response.content);
    });
};

export default {
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
            idNumber: '1',
            resolved: true,
            internalNote: 'New Note',
            investigationNote: 'New Investigation',
            createdAt: new Date().toISOString(),
            createdBy: 'oneuptime',
            resolvedAt: new Date().toISOString(),
            resolvedBy: 'oneuptime',
            monitorName: 'New Sample',
            monitorType: 'url',
            monitorData: 'https://oneuptime.com',
        },
    },
};
