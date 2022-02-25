const resolveAllIncidents = (z, bundle) => {
    if (bundle.cleanedRequest) return bundle.cleanedRequest;
    const data = {
        monitors: bundle.inputData.monitors,
    };
    const responsePromise = z.request({
        method: 'POST',
        url: `${bundle.authData.serverUrl}/zapier/incident/resolveAllIncidents`,
        body: data,
    });
    return responsePromise.then(response => JSON.parse(response.content));
};

export default {
    key: 'resolve_all_incidents',
    noun: 'resolve',

    display: {
        label: 'Resolve All Incidents',
        description: 'Resolves all incidents.',
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
        perform: resolveAllIncidents,
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
