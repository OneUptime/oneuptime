module.exports = [
    {
        allowedVariables: [
            '{{incidentTime}} : Time at which this incident occured.',
            '{{monitorName}} : Name of the monitor on which incident has occured.',
            '{{projectName}} : Name of the project on which the incident has occured.',
            '{{incidentType}} : Type of incident. Online, offline or degraded.',
            '{{componentName}} : Name of the component the monitor belongs to',
            '{{statusPageUrl}} : URL of the Status Page your subscriber can go to. ',
            '{{incident.customFields.*}} : The value of any incident custom field',
            '{{monitor.customFields.*}} : The value of any monitor custom field',
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
            '{{incident.customFields.*}} : The value of any incident custom field',
            '{{monitor.customFields.*}} : The value of any monitor custom field',
            '{{length}} : Length of the incident',
        ],
        smsType: 'Subscriber Incident Acknowldeged',
        body:
            '{{projectName}} - {{incidentType}} incident on {{componentName}}/{{monitorName}} is acknowledged at {{incidentTime}}. You are receiving this message because you subscribed to this monitor.',
    },
    {
        allowedVariables: [
            '{{incidentTime}} : Time at which this incident occured.',
            '{{monitorName}} : Name of the monitor on which incident has occured.',
            '{{projectName}} : Name of the project on which the incident has occured.',
            '{{incidentType}} : Type of incident. Online, offline or degraded.',
            '{{componentName}} : Name of the component the monitor belongs to',
            '{{statusPageUrl}} : URL of the Status Page your subscriber can go to. ',
            '{{incident.customFields.*}} : The value of any incident custom field',
            '{{monitor.customFields.*}} : The value of any monitor custom field',
            '{{length}} : Length of the incident',
        ],
        smsType: 'Subscriber Incident Resolved',
        body:
            '{{projectName}} - {{incidentType}} incident on {{componentName}}/{{monitorName}} is resolved at {{incidentTime}}. You are receiving this message because you subscribed to this monitor.',
    },
    {
        allowedVariables: [
            '{{incidentTime}} : Time at which this incident occured.',
            '{{monitorName}} : Name of the monitor on which incident has occured.',
            '{{projectName}} : Name of the project on which the incident has occured.',
            '{{incidentType}} : Type of incident. Online, offline or degraded.',
            '{{componentName}} : Name of the component the monitor belongs to',
            '{{statusPageUrl}} : URL of the Status Page your subscriber can go to. ',
            '{{incident.customFields.*}} : The value of any incident custom field',
            '{{monitor.customFields.*}} : The value of any monitor custom field',
            '{{incidentNote}} : The content of the investigation note',
        ],
        smsType: 'Investigation note is created',
        body:
            'A new update has been added to an incident on {{monitorName}}. {{#if statusPageUrl}}Please check it out here {{statusPageUrl}}{{/if}}',
    },
    {
        allowedVariables: [
            '{{eventName}} : Name of the scheduled event.',
            '{{eventDescription}} : Description of the scheduled event.',
            '{{eventStartTime}} : Time at which scheduled event is starts.',
            '{{eventEndTime}} : Time at which scheduled event ends.',
            '{{projectName}} : Name of the project on which the event is created.',
        ],
        smsType: 'Subscriber Scheduled Maintenance Created',
        body:
            'New Scheduled Maintenance Event - {{eventName}} for {{projectName}}. Starts at: {{eventStartTime}}, Ends at {{eventEndTime}}.',
    },
    {
        allowedVariables: [
            '{{eventName}} : Name of the scheduled event.',
            '{{eventResolveTime}} : Time at which scheduled event is resolved.',
            '{{projectName}} : Name of the project on which the event is created.',
        ],
        smsType: 'Subscriber Scheduled Maintenance Resolved',
        body:
            'Scheduled maintenance event - {{eventName}} for {{projectName}} is resolved',
    },
    {
        allowedVariables: [
            '{{eventName}} : Name of the scheduled event.',
            '{{eventNoteState}} : State of event note.',
            '{{eventNoteType}} : Type of note.',
            '{{eventNoteContent}} : Content of event note.',
        ],
        smsType: 'Subscriber Scheduled Maintenance Note',
        body:
            'A new note has been added to the scheduled maintenance event - {{eventName}}. State: {{eventNoteState}}, Content: {{eventNoteContent}}',
    },
];
