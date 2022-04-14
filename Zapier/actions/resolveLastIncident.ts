const resolveLastIncident: Function = (z: $TSFixMe, bundle: $TSFixMe): void => {
    if (bundle.cleanedRequest) {
        return bundle.cleanedRequest;
    }
    const data = {
        monitors: bundle.inputData.monitors,
    };
    const responsePromise = z.request({
        method: 'POST',
        url: `h${bundle.authData.serverUrl}/zapier/incident/resolveLastIncident`,
        body: data,
    });
    return responsePromise.then((response: $TSFixMe) =>
        JSON.parse(response.content)
    );
};

export default {
    key: 'resolve_last_incident',
    noun: 'resolve',

    display: {
        label: 'Resolve Last Incident',
        description: 'Resolves last incident.',
        important: false,
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
        perform: resolveLastIncident,
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
