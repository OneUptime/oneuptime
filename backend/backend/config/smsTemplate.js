module.exports = [{
    allowedVariables: ['{{ incidentTime }} : Time at which this incident occured.', '{{ monitorName }} : Name of the monitor on which incident has occured.'],
    smsType: 'Subscriber Incident',
    body: '{{monitorName}} is down at {{ incidentTime }}. You are receiving this message because you subscribed to this monitor.'
}];