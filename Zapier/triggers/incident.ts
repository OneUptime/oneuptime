const triggerIncident: Function = (z: $TSFixMe, bundle: $TSFixMe): void => {
    return bundle.cleanedRequest;
};

const fallbackHook: Function = (z: $TSFixMe, bundle: $TSFixMe): void => {
    // For the test poll, you should get some real data, to aid the setup process.
    const options: $TSFixMe = {
        url: `${bundle.authData.serverUrl}/zapier/incidents`,
    };

    return z.request(options).then((response: $TSFixMe) => {
        return JSON.parse(response.content);
    });
};

const subscribeHook: Function = (z: $TSFixMe, bundle: $TSFixMe): void => {
    // Bundle.targetUrl has the Hook URL this app should call when an incident is created.
    const data: $TSFixMe = {
        url: bundle.targetUrl,
        type: 'incident_created',
        input: bundle.inputData,
    };

    const options: $TSFixMe = {
        url: `${bundle.authData.serverUrl}/zapier/subscribe`,
        method: 'POST',
        body: data,
    };

    // You may return a promise or a normal data structure from any perform method.
    return z.request(options).then((response: $TSFixMe) => {
        return JSON.parse(response.content);
    });
};

const unSubscribeHook: Function = (z: $TSFixMe, bundle: $TSFixMe): void => {
    /*
     * Bundle.subscribeData contains the parsed response JSON from the subscribe
     * Request made initially.
     */
    const hookId: $TSFixMe = bundle.subscribeData.id;

    /*
     * You can build requests and our client will helpfully inject all the variables
     * You need to complete. You can also register middleware to control this.
     */
    const options: $TSFixMe = {
        url: `${bundle.authData.serverUrl}/zapier/unSubscribe/${hookId}`,
        method: 'DELETE',
    };

    // You may return a promise or a normal data structure from any perform method.
    return z.request(options).then((response: $TSFixMe) => {
        return JSON.parse(response.content);
    });
};

export default {
    key: 'incident',
    noun: 'Incident',

    display: {
        label: 'New Incident',
        description: 'Triggers when a new incident is created.',
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
        perform: triggerIncident,
        performList: fallbackHook,
        performSubscribe: subscribeHook,
        performUnsubscribe: unSubscribeHook,
        sample: {
            projectName: 'New Project',
            projectId: '1',
            incidentId: '1',
            idNumber: 1,
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
