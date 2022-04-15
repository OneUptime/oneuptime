const createIncidentNote: Function = (z: $TSFixMe, bundle: $TSFixMe): void => {
    if (bundle.cleanedRequest) {
        return bundle.cleanedRequest;
    }
    const data: $TSFixMe = {
        data: bundle.inputData,
    };
    const responsePromise: $TSFixMe = z.request({
        method: 'POST',
        url: `${bundle.authData.serverUrl}/zapier/incident/incident-note`,
        body: data,
    });
    return responsePromise.then((response: $TSFixMe) => {
        return JSON.parse(response.content);
    });
};

export default {
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
            {
                key: 'type',
                type: 'string',
                placeholder: 'Enter Incident Type',
                required: true,
                label: 'Type',
            },
            {
                key: 'content',
                type: 'string',
                placeholder: 'Enter Content',
                required: true,
                label: 'Content',
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
