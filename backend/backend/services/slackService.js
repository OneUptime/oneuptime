module.exports = {

    // process messages to be sent to slack workspace channels
    sendNotification: async function (projectId, incidentId, userId, text, incident) {
        var self = this;

        try{
            var project = await ProjectService.findOneBy({_id: projectId});
        }catch(error){
            ErrorService.log('ProjectService.findOneBy', error);
            throw error;
        }
        try{
            var integrations = await IntegrationModel.find({
                projectId,
                integrationType: 'slack'
            });
        }catch(error){
            ErrorService.log('IntegrationModel.find', error);
            throw error;
        }
        if (integrations.length === 0) return 'no connected slack workspace to notify';
        for (const integration of integrations) {

            try{
                // call the notify function that just sends the slack notification
                var response = await self.notify(integration, project, text, incident, incidentId);
            }catch(error){
                ErrorService.log('slackservice.notify', error);
                throw error;
            }
            return response;
        }
    },

    // send notification to slack workspace channels
    async notify(team, project, text, incident, incidentId) {

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
            try{
                var response = await web.chat.postMessage({
                    channel: channelId,
                    text: slackText,
                    attachments: [incAttachment]
                });
            }catch(error){
                ErrorService.log('web.chat.postMessage', error);
                throw error;
            }
            return response;

        } else {
            try{
                var res = await web.chat.postMessage({
                    channel: channelId,
                    text: slackText
                });
            }catch(error){
                ErrorService.log('', error);
                throw error;
            }
            return (`Message sent: ${res.ts}`);
        }
    }
};

var {
    WebClient
} = require('@slack/client');
var IntegrationModel = require('../models/integration');
var ProjectService = require('./projectService');
var ErrorService = require('./errorService');

