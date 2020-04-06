const authentication = require('./authentication');
// import triggers
const resolvedTrigger = require('./triggers/resolved');
const incidentTrigger = require('./triggers/incident');
const monitorTrigger = require('./triggers/monitors');
const acknowledgeTrigger = require('./triggers/acknowledge');
const incidentsTrigger = require('./triggers/incidents');
// import actions
const createIncidentAction = require('./actions/createIncident');
const acknowledgeLastIncidentAction = require('./actions/acknowledgeLastIncident');
const resolveLastIncidentAction = require('./actions/resolveLastIncident');
const acknowledgeAllIncidentsAction = require('./actions/acknowledgeAllIncidents');
const resolveAllIncidentsAction = require('./actions/resolveAllIncidents');
const acknowledgeIncidentAction = require('./actions/acknowledgeIncident');
const resolveIncidentAction = require('./actions/resolveIncident');

// To include the API key on all outbound requests, simply define a function here.
// It runs runs before each request is sent out, allowing you to make tweaks to the request in a centralized spot.
const includeApiKey = (request, z, bundle) => {
    if (bundle.authData.apiKey && bundle.authData.projectId) {
        request.params = request.params || {};
        request.params.apiKey = bundle.authData.apiKey;
        request.params.projectId = bundle.authData.projectId;
    }
    return request;
};

const App = {
    // This is just shorthand to reference the installed dependencies you have. Zapier will
    // need to know these before we can upload
    version: require('./package.json').version,
    platformVersion: require('zapier-platform-core').version,

    authentication: authentication,

    beforeRequest: [includeApiKey],

    afterResponse: [],

    resources: {},

    // If you want your trigger to show up, you better include it here!
    triggers: {
        [incidentTrigger.key]: incidentTrigger,
        [resolvedTrigger.key]: resolvedTrigger,
        [monitorTrigger.key]: monitorTrigger,
        [acknowledgeTrigger.key]: acknowledgeTrigger,
        [incidentsTrigger.key]: incidentsTrigger,
    },

    // If you want your searches to show up, you better include it here!
    searches: {},

    // If you want your creates to show up, you better include it here!
    creates: {
        [createIncidentAction.key]: createIncidentAction,
        [acknowledgeLastIncidentAction.key]: acknowledgeLastIncidentAction,
        [resolveLastIncidentAction.key]: resolveLastIncidentAction,
        [acknowledgeAllIncidentsAction.key]: acknowledgeAllIncidentsAction,
        [resolveAllIncidentsAction.key]: resolveAllIncidentsAction,
        [acknowledgeIncidentAction.key]: acknowledgeIncidentAction,
        [resolveIncidentAction.key]: resolveIncidentAction,
    },
};

// Finally, export the app.
module.exports = App;
