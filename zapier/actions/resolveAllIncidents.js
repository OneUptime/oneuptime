const resolveAllIncidents = (z, bundle) => {
  if(bundle.cleanedRequest) return bundle.cleanedRequest;
    const data = {
        monitors: bundle.inputData.monitors
    };
  const responsePromise = z.request({
    method: 'POST',
    url: 'https://api.fyipe.com/zapier/incident/resolveAllIncidents',
    body: data
  });
  return responsePromise
    .then(response => JSON.parse(response.content));
};

module.exports = {
  key: 'resolve_all_incidents',
  noun: 'resolve',

  display: {
    label: 'Resolve All Incidents',
    description: 'Resolves all incidents.',
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
    perform: resolveAllIncidents,
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