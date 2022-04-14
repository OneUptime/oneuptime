const acknowledgeIncident = (z: $TSFixMe, bundle: $TSFixMe): void => {
    if (bundle.cleanedRequest) {
        return bundle.cleanedRequest;
    }
    const data = {
        incidents: bundle.inputData.incidents,
    };
    const responsePromise = z.request({
        method: 'POST',
        url: `${bundle.authData.serverUrl}/zapier/incident/acknowledgeIncident`,
        body: data,
    });
    return responsePromise.then((response: $TSFixMe) =>
        JSON.parse(response.content)
    );
};

export default {
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
            idNumber: '1',
            acknowledged: true,
            resolved: false,
            internalNote: 'New Note',
            investigationNote: 'New Investigation',
            createdAt: new Date().toISOString(),
            createdBy: 'oneuptime',
            acknowledgedAt: new Date().toISOString(),
            acknowledgedBy: 'oneuptime',
            monitorName: 'New Sample',
            monitorType: 'url',
            monitorData: 'https://oneuptime.com',
        },
    },
};
