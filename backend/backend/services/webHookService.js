
module.exports = {

    // process messages to be sent to slack workspace channels
    sendNotification: async function (projectId, incident, monitor, incidentStatus) {
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
            var monitorStatus = await MonitorStatusService.findOneBy({ monitorId: monitor._id });
            // if (integrations.length === 0) deferred.resolve('no webhook added for this to notify');
            for (const integration of integrations) {
                response = await self.notify(project, monitor, incident, integration, monitorStatus.status);
            }
            return response;
        } catch (error) {
            ErrorService.log('WebHookService.sendNotification', error);
            throw error;
        }
    },

    // send notification to slack workspace channels
    async notify(project, monitor, incident, integration, monitorStatus) {
        try {
            let data = {
                monitorName: monitor.name,
                monitorId: monitor._id,
                projectId: project._id,
                projectName: project.name,
                createdAt: incident.createdAt,
                createdBy: incident.createdById.name,
                incidentStatus: incident.incidentType,
                monitorStatus,
            };
            if (incident.acknowledged) {
                data.acknowledgedBy = incident.acknowledgedBy.name;
                data.acknowledgedAt = incident.acknowledgedAt;
            }
            if (incident.resolved) {
                data.resolvedBy = incident.resolvedBy.name;
                data.resolvedAt = incident.resolvedAt;
            }
            if(integration.data.endpointType === 'get') {
                await axios.get(integration.data.endpoint, {
                    params: { ...data }
                },{
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                return 'Webhook successfully pinged';
            } else if (integration.data.endpointType === 'post') {
                await axios.post(integration.data.endpoint, {
                    ...data
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
var MonitorStatusService = require('./monitorStatusService');
var ErrorService = require('./errorService');
