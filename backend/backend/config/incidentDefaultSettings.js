export default {
    incidentDefaultSettings: {
        title: '{{monitorName}} is {{incidentType}}.',
        description:
            '{{monitorName}} is {{incidentType}}. This incident is currently being investigated by our team and more information will be added soon.',
    },
    variables: [
        {
            name: 'incidentType',
            definition: 'Type of incident.',
        },
        {
            name: 'monitorName',
            definition: 'Name of the monitor on which incident has occured.',
        },
        {
            name: 'projectName',
            definition:
                'Name of the project on which the incident has occured.',
        },
        {
            name: 'time',
            definition: 'Time when the incident has occured.',
        },
        {
            name: 'date',
            definition: 'Date when the incident has occured.',
        },
    ],
};
