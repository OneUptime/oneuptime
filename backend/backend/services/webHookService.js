
module.exports = {

    // process messages to be sent to slack workspace channels
    sendNotification: async function (projectId, text, monitor, incidentStatus) {
        try {
            var self = this;
            var response;
            var project = await ProjectService.findOneBy({_id: projectId});
            if (project && project.parentProjectId) {
                projectId = project.parentProjectId._id;
            }
            var query = { projectId: projectId, integrationType: 'webhook', monitorId: monitor._id };
            if (incidentStatus === 'resolved') {
                query = {...query, 'notificationOptions.incidentResolved' : true};
            } else if (incidentStatus === 'created') {
                query = {...query, 'notificationOptions.incidentCreated' : true};
            } else if (incidentStatus === 'acknowledged') {
                query = {...query, 'notificationOptions.incidentAcknowledged' : true};
            } else { return; }
            var integrations = await IntegrationService.findBy(query);
            // if (integrations.length === 0) deferred.resolve('no webhook added for this to notify');
            for (const integration of integrations) {
                response = await self.notify(project, monitor, text, integration);
            }
            return response;
        } catch (error) {
            ErrorService.log('WebHookService.sendNotification', error);
            throw error;
        }
    },

    // send notification to slack workspace channels
    async notify(project, monitor, message, integration) {
        try {
            if(integration.data.endpointType === 'get') {
                await axios.get(integration.data.endpoint, {
                    message,
                    monitorName: monitor.name,
                    monitorId: monitor._id,
                    projectId: project._id,
                    projectName: project.name,
                },{
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                return 'Webhook successfully pinged';
            } else if (integration.data.endpointType === 'post') {
                await axios.post(integration.data.endpoint, {
                    message,
                    monitorName: monitor.name,
                    monitorId: monitor._id,
                    projectId: project._id,
                    projectName: project.name,
                },{
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                return 'Webhook successfully pinged';
            } else {
                let error = new Error('Webhook endpoint type missing');
                error.code = 400;
                ErrorService.log('WebHookService.notify', error);
                throw error;
            }
        } catch (error) {
            ErrorService.log('WebHookService.notify', error);
            throw error;
        }
    }
};

var IntegrationService = require('./integrationService');
var axios = require('axios');
var ProjectService = require('./projectService');
var ErrorService = require('./errorService');
