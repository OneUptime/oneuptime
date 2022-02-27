const triggerIncidentNote = (z: $TSFixMe, bundle: $TSFixMe) => {
    return bundle.cleanedRequest;
};

const fallbackHook = (z: $TSFixMe, bundle: $TSFixMe) => {
    // For the test poll, you should get some real data, to aid the setup process.
    const options = {
        url: `${bundle.authData.serverUrl}/zapier/incident-note`,
    };

    return z
        .request(options)
        .then((response: $TSFixMe) => JSON.parse(response.content));
};
const subscribeHook = (z: $TSFixMe, bundle: $TSFixMe) => {
    // bundle.targetUrl has the Hook URL this app should call when an incident is acknowledged.
    const data = {
        url: bundle.targetUrl,
        type: 'incident_note',
        input: bundle.inputData,
    };

    const options = {
        url: `${bundle.authData.serverUrl}/zapier/subscribe`,
        method: 'POST',
        body: data,
    };

    // You may return a promise or a normal data structure from any perform method.
    return z
        .request(options)
        .then((response: $TSFixMe) => JSON.parse(response.content));
};

const unSubscribeHook = (z: $TSFixMe, bundle: $TSFixMe) => {
    // bundle.subscribeData contains the parsed response JSON from the subscribe
    // request made initially.
    const hookId = bundle.subscribeData.id;

    // You can build requests and our client will helpfully inject all the variables
    // you need to complete. You can also register middleware to control this.
    const options = {
        url: `${bundle.authData.serverUrl}/zapier/unSubscribe/${hookId}`,
        method: 'DELETE',
    };

    // You may return a promise or a normal data structure from any perform method.
    return z
        .request(options)
        .then((response: $TSFixMe) => JSON.parse(response.content));
};

export default {
    key: 'incident_note',
    noun: 'incident note',

    display: {
        label: 'Incident Note',
        description: 'Triggers when a new incident note is added.',
        important: false,
    },

    operation: {
        type: 'hook',
        inputFields: [
            {
                key: 'monitors',
                type: 'string',
                placeholder: 'list of monitors',
                dynamic: 'monitors.id.name',
                altersDynamicFields: true,
                list: true,
                required: false,
            },
        ],
        perform: triggerIncidentNote,
        performList: fallbackHook,
        performSubscribe: subscribeHook,
        performUnsubscribe: unSubscribeHook,
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
