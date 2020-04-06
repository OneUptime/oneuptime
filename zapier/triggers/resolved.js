const resolveIncident = (z, bundle) => {
    return bundle.cleanedRequest;
};

const fallbackHook = z => {
    // For the test poll, you should get some real data, to aid the setup process.
    const options = {
        url: 'https://fyipe.com/api/zapier/incident/resolved',
    };

    return z.request(options).then(response => JSON.parse(response.content));
};

const subscribeHook = (z, bundle) => {
    z.console.log(bundle);

    // bundle.targetUrl has the Hook URL this app should call when an incident is resolved.
    const data = {
        url: bundle.targetUrl,
        type: 'incident_resolve',
        input: bundle.inputData,
    };

    const options = {
        url: 'https://fyipe.com/api/zapier/subscribe',
        method: 'POST',
        body: data,
    };

    // You may return a promise or a normal data structure from any perform method.
    return z.request(options).then(response => JSON.parse(response.content));
};

const unSubscribeHook = (z, bundle) => {
    // bundle.subscribeData contains the parsed response JSON from the subscribe
    // request made initially.
    const hookId = bundle.subscribeData.id;

    // You can build requests and our client will helpfully inject all the variables
    // you need to complete. You can also register middleware to control this.
    const options = {
        url: `https://fyipe.com/api/zapier/unSubscribe/${hookId}`,
        method: 'DELETE',
    };

    // You may return a promise or a normal data structure from any perform method.
    return z.request(options).then(response => JSON.parse(response.content));
};

module.exports = {
    key: 'incident_resolve',
    noun: 'Resolve',

    display: {
        label: 'Resolved Incident',
        description: 'Triggers when an incident is resolved.',
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
                required: false,
            },
        ],
        type: 'hook',
        perform: resolveIncident,
        performList: fallbackHook,
        performSubscribe: subscribeHook,
        performUnsubscribe: unSubscribeHook,
        sample: {
            projectName: 'New Project',
            projectId: '1',
            incidentId: '1',
            acknowledged: true,
            resolved: true,
            internalNote: 'New Note',
            investigationNote: 'New Investigation',
            createdAt: new Date().toISOString(),
            createdBy: 'fyipe',
            acknowledgedAt: new Date().toISOString(),
            acknowledgedBy: 'fyipe',
            resolvedAt: new Date().toISOString(),
            resolvedBy: 'fyipe',
            monitorName: 'New Sample',
            monitorType: 'url',
            monitorData: 'https://fyipe.com',
        },
    },
};
