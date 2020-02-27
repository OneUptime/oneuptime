module.exports = [
    {
        allowedVariables: [
            '{{incidentTime}} : Time at which this incident occured.',
            '{{monitorName}} : Name of the monitor on which incident has occured.',
            '{{projectName}} : Name of the project on which the incident has occured.',
            '{{incidentType}} : Type of incident.',
        ],
        smsType: 'Subscriber Incident Created',
        body:
            '{{projectName}}/{{monitorName}} is {{incidentType}} at {{incidentTime}}. You are receiving this message because you subscribed to this monitor.',
    },
    {
        allowedVariables: [
            '{{incidentTime}} : Time at which this incident occured.',
            '{{monitorName}} : Name of the monitor on which incident has occured.',
            '{{projectName}} : Name of the project on which the incident has occured.',
            '{{incidentType}} : Type of incident.',
        ],
        smsType: 'Subscriber Incident Acknowldeged',
        body:
            '{{projectName}}/{{monitorName}} is {{incidentType}} at {{incidentTime}}. You are receiving this message because you subscribed to this monitor.',
    },
    {
        allowedVariables: [
            '{{incidentTime}} : Time at which this incident occured.',
            '{{monitorName}} : Name of the monitor on which incident has occured.',
            '{{projectName}} : Name of the project on which the incident has occured.',
            '{{incidentType}} : Type of incident.',
        ],
        smsType: 'Subscriber Incident Resolved',
        body:
            '{{projectName}}/{{monitorName}} is {{incidentType}} at {{incidentTime}}. You are receiving this message because you subscribed to this monitor.',
    },
];
