// fetches a list of records from the endpoint
const fetchList: Function = (z: $TSFixMe, bundle: $TSFixMe): void => {
    const options: $TSFixMe = {
        url: `${bundle.authData.serverUrl}/zapier/monitors`,
    };
    return z.request(options).then((response: $TSFixMe) => {
        return JSON.parse(response.content);
    });
};

export default {
    key: 'monitors',
    noun: 'Monitors',
    display: {
        label: 'List of Monitors',
        description: 'List of monitors for dropdown',
        hidden: true,
    },

    operation: {
        // since this is a "hidden" trigger, there aren't any inputFields needed
        perform: fetchList,
        // the folowing is a "hint" to the Zap Editor that this trigger returns data "in pages", and
        //   that the UI should display an option to "load next page" to the human.
        canPaginate: false,
    },
};
