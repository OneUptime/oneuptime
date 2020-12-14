module.exports = [
    {
        allowedVariables: [
            '{{incidentTime}} : Time at which this incident occured.',
            '{{monitorName}} : Name of the monitor on which incident has occured.',
            '{{projectName}} : Name of the project on which the incident has occured.',
            '{{incidentType}} : Type of incident. Online, offline or degraded.',
            '{{componentName}} : Name of the component the monitor belongs to',
            '{{statusPageUrl}} : URL of the Status Page your subscriber can go to. ',
        ],
        smsType: 'Subscriber Incident Created',
        body:
            '{{projectName}} - {{componentName}}/{{monitorName}} is {{incidentType}} at {{incidentTime}}. You are receiving this message because you subscribed to this monitor.',
    },
    {
        allowedVariables: [
            '{{incidentTime}} : Time at which this incident occured.',
            '{{monitorName}} : Name of the monitor on which incident has occured.',
            '{{projectName}} : Name of the project on which the incident has occured.',
            '{{incidentType}} : Type of incident. Online, offline or degraded.',
            '{{componentName}} : Name of the component the monitor belongs to',
            '{{statusPageUrl}} : URL of the Status Page your subscriber can go to. ',
        ],
        smsType: 'Subscriber Incident Acknowldeged',
        body:
            '{{projectName}} - {{componentName}}/{{monitorName}} is {{incidentType}} at {{incidentTime}}. You are receiving this message because you subscribed to this monitor.',
    },
    {
        allowedVariables: [
            '{{incidentTime}} : Time at which this incident occured.',
            '{{monitorName}} : Name of the monitor on which incident has occured.',
            '{{projectName}} : Name of the project on which the incident has occured.',
            '{{incidentType}} : Type of incident. Online, offline or degraded.',
            '{{componentName}} : Name of the component the monitor belongs to',
            '{{statusPageUrl}} : URL of the Status Page your subscriber can go to. ',
        ],
        smsType: 'Subscriber Incident Resolved',
        body:
            '{{projectName}} - {{componentName}}/{{monitorName}} is {{incidentType}} at {{incidentTime}}. You are receiving this message because you subscribed to this monitor.',
    },
    {
        allowedVariables: [
            '{{incidentTime}} : Time at which this incident occured.',
            '{{monitorName}} : Name of the monitor on which incident has occured.',
            '{{projectName}} : Name of the project on which the incident has occured.',
            '{{incidentType}} : Type of incident. Online, offline or degraded.',
            '{{componentName}} : Name of the component the monitor belongs to',
            '{{statusPageUrl}} : URL of the Status Page your subscriber can go to. ',
        ],
        smsType: 'Investigation note is created',
        body:
            'A new update has been added to an incident on {{monitorName}}. {{#if statusPageUrl}}Please check it out here {{statusPageUrl}}{{/if}}',
    },
];
