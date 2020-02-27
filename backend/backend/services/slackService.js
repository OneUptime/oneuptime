module.exports = {
    // process messages to be sent to slack workspace channels
    sendNotification: async function(
        projectId,
        incidentId,
        userId,
        text,
        incident
    ) {
        try {
            const self = this;
            const project = await ProjectService.findOneBy({ _id: projectId });
            const integrations = await IntegrationModel.find({
                projectId,
                integrationType: 'slack',
            });

            if (integrations.length === 0)
                return 'no connected slack workspace to notify';
            for (const integration of integrations) {
                // call the notify function that just sends the slack notification
                const response = await self.notify(
                    integration,
                    project,
                    text,
                    incident,
                    incidentId
                );
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
                const response = await web.chat.postMessage({
                    channel: channelId,
                    text: slackText,
                    attachments: [incAttachment],
                });

                return response;
            } else {
                const res = await web.chat.postMessage({
                    channel: channelId,
                    text: slackText,
                });
                return `Message sent: ${res.ts}`;
            }
        } catch (error) {
            ErrorService.log('slackService.notify', error);
            throw error;
        }
    },
};

const { WebClient } = require('@slack/client');
const IntegrationModel = require('../models/integration');
const ProjectService = require('./projectService');
const ErrorService = require('./errorService');
