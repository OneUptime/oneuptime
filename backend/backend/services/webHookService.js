
module.exports = {

    // process messages to be sent to slack workspace channels
    sendNotification: async function (projectId, text, monitor) {
        var self = this;
        var response;
        try {
            var project = await ProjectService.findOneBy({_id: projectId});
            var integrations = await IntegrationService.findBy({
                projectId: projectId,
                integrationType: 'webhook',
                monitors: { $in: [monitor._id] }
            });
            // if (integrations.length === 0) deferred.resolve('no webhook added for this to notify');
            for (const integration of integrations) {
                response = await self.notify(project, monitor, text, integration);
            }
        } catch (error) {
            if (error.message.indexOf('"_id"') !== -1) {
                ErrorService.log('ProjectService.findOneBy', error);
            } else if (error.message.indexOf('"projectId"') !== -1) {
                ErrorService.log('IntegrationService.findBy', error);
            } else {
                ErrorService.log('WebHookService.notify', error);
            }
            throw error;
        }
        return response;
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
            if (error.message.indexOf('post') !== -1) {
                ErrorService.log('axios.post', error);
            } else if (error.message.indexOf('get') !== -1) {
                ErrorService.log('axios.get', error);
            } else {
                ErrorService.log('WebHookService.notify', error);
            }
            throw error;
        }
    }
};

var IntegrationService = require('./integrationService');
var axios = require('axios');
var ProjectService = require('./projectService');
var ErrorService = require('./errorService');