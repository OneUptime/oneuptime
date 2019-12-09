module.exports = {

    // process messages to be sent to slack workspace channels
    sendNotification: async function (projectId, incidentId, userId, text, incident) {
        try {
            var self = this;
            var project = await ProjectService.findOneBy({_id: projectId});
            var integrations = await IntegrationModel.find({
                projectId,
                integrationType: 'slack'
            });

            if (integrations.length === 0) return 'no connected slack workspace to notify';
            for (const integration of integrations) {
                // call the notify function that just sends the slack notification
                var response = await self.notify(integration, project, text, incident, incidentId);
                return response;
            }
        } catch (error) {
            ErrorService.log('slackService.sendNotification', error);
            throw error;  
        }
    },

    // send notification to slack workspace channels
    async notify(team, project, text, incident, incidentId) {        
        try {
            const token = team.data.accessToken;
            const web = new WebClient(token);
            const channelId = team.data.channelId; //project.channelId;
            const color = incident ? 'danger' : 'good';
    
            const slackText = `${project.name}: ${text}`;
            if (incident) {
                const incAttachment = {
                    text: slackText,
                    fallback: slackText,
                    callback_id: incidentId,
                    color: color,
                    attachment_type: 'default',
                };
                var response = await web.chat.postMessage({
                    channel: channelId,
                    text: slackText,
                    attachments: [incAttachment]
                });

                return response;
            } else {
                var res = await web.chat.postMessage({
                    channel: channelId,
                    text: slackText
                });
                return (`Message sent: ${res.ts}`);
            }
        } catch (error) {
            ErrorService.log('slackService.notify', error);
            throw error; 
        }
    }
};

var {
    WebClient
} = require('@slack/client');
var IntegrationModel = require('../models/integration');
var ProjectService = require('./projectService');
var ErrorService = require('./errorService');
