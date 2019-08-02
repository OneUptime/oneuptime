
module.exports = {

    // process messages to be sent to slack workspace channels
    sendNotification: async function (projectId, text, monitor) {
        var self = this;
        var response;
        try{
            var project = await ProjectService.findOneBy({_id: projectId});
        }catch(error){
            ErrorService.log('ProjectService.findOneBy', error);
            throw error;
        }
        try{
            var integrations = await IntegrationService.findBy({
                projectId: projectId,
                integrationType: 'webhook',
                monitors: { $in: [monitor._id] }
            });
        }catch(error){
            ErrorService.log('IntegrationService.findBy', error);
            throw error;
        }
        // if (integrations.length === 0) deferred.resolve('no webhook added for this to notify');
        for (const integration of integrations) {
            try{
                response = await self.notify(project, monitor, text, integration);
            }catch(error){
                ErrorService.log('WebHookService.notify', error);
                throw error;
            }
        }
        return response;
    },

    // send notification to slack workspace channels
    async notify(project, monitor, message, integration) {
    
        if(integration.data.endpointType === 'get') {
            try{
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
            }catch(error){
                ErrorService.log('axios.get', error);
                throw error;
            }
            return 'Webhook successfully pinged';
        }else if (integration.data.endpointType === 'post') {
            try{
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
            }catch(error){
                ErrorService.log('axios.post', error);
                throw error;
            }
            return 'Webhook successfully pinged';
        }else {
            let error = new Error('Webhook endpoint type missing');
            error.code = 400;
            ErrorService.log('WebHookService.notify', error);
            throw error;
        }
    }
};

var IntegrationService = require('./integrationService');
var axios = require('axios');
var ProjectService = require('./projectService');
var ErrorService = require('./errorService');