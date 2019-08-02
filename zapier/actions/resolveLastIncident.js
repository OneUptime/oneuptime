const resolveLastIncident = (z, bundle) => {
  if (bundle.cleanedRequest) return bundle.cleanedRequest;
  const data = {
      monitors: bundle.inputData.monitors
  };
  const responsePromise = z.request({
    method: 'POST',
    url: 'https://api.fyipe.com/zapier/incident/resolveLastIncident',
    body: data
  });
  return responsePromise
    .then(response => JSON.parse(response.content));
};

module.exports = {
  key: 'resolve_last_incident',
  noun: 'resolve',

  display: {
    label: 'Resolve Last Incident',
    description: 'Resolves last incident.',
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
    perform: resolveLastIncident,
    sample: {
        projectName: 'New Project',
        projectId: '1', 
        incidentId: '1',
        resolved: true,
        internalNote: 'New Note',
        investigationNote: 'New Investigation',
        createdAt: new Date().toISOString(),
        createdBy: 'fyipe',
        resolvedAt: new Date().toISOString(),
        resolvedBy: 'fyipe',
        monitorName: 'New Sample',
        monitorType: 'url',
        monitorData: 'https://fyipe.com'
    }
  }
};