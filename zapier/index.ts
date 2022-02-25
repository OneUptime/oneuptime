import authentication from './authentication'
// import triggers
import resolvedTrigger from './triggers/resolved'
import incidentTrigger from './triggers/incident'
import monitorTrigger from './triggers/monitors'
import acknowledgeTrigger from './triggers/acknowledge'
import incidentsTrigger from './triggers/incidents'
import incidentNoteTrigger from './triggers/incidentNote'
// import actions
import createIncidentAction from './actions/createIncident'
import acknowledgeLastIncidentAction from './actions/acknowledgeLastIncident'
import resolveLastIncidentAction from './actions/resolveLastIncident'
import acknowledgeAllIncidentsAction from './actions/acknowledgeAllIncidents'
import resolveAllIncidentsAction from './actions/resolveAllIncidents'
import acknowledgeIncidentAction from './actions/acknowledgeIncident'
import resolveIncidentAction from './actions/resolveIncident'
import createIncidentNoteAction from './actions/createIncidentNote'

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
        [incidentNoteTrigger.key]: incidentNoteTrigger,
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
        [createIncidentNoteAction.key]: createIncidentNoteAction,
    },
};

// Finally, export the app.
export default App;
