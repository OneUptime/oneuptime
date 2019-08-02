const acknowledgeLastIncident = (z, bundle) => {
  if (bundle.cleanedRequest) return bundle.cleanedRequest;
  const data = {
      monitors: bundle.inputData.monitors
  };
  const responsePromise = z.request({
    method: 'POST',
    url: 'https://api.fyipe.com/zapier/incident/acknowledgeLastIncident',
    body: data
  });
  return responsePromise
    .then(response => JSON.parse(response.content));
};

module.exports = {
  key: 'acknowledge_last_incident',
  noun: 'Acknowledge',

  display: {
    label: 'Acknowledge Last Incident',
    description: 'Acknowledges last incident.',
    important: true
  },

  operation: {
    inputFields: [
        {
          key: 'monitors',
          type: 'string',
          placeholder:'list of monitors',
          dynamic: 'monitors.id.name',
          altersDynamicFields: true,
          list:true,
          required: true
        }
    ],
    perform: acknowledgeLastIncident,
    sample: {
        projectName: 'New Project',
        projectId: '1', 
        incidentId: '1',
        acknowledged: true,
        resolved: false,
        internalNote: 'New Note',
        investigationNote: 'New Investigation',
        createdAt: new Date().toISOString(),
        createdBy: 'fyipe',
        acknowledgedAt: new Date().toISOString(),
        acknowledgedBy: 'fyipe',
        monitorName: 'New Sample',
        monitorType: 'url',
        monitorData: 'https://fyipe.com'
    }
  }
};