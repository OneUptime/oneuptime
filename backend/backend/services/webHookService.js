module.exports = {
    // process messages to be sent to slack workspace channels
    sendNotification: async function (
        projectId,
        incident,
        monitor,
        incidentStatus,
        component,
        duration
    ) {
        try {
            const self = this;
            let response;
            const project = await ProjectService.findOneBy({ _id: projectId });
            if (project && project.parentProjectId) {
                projectId = project.parentProjectId._id;
            }
            let query = {
                projectId: projectId,
                integrationType: 'webhook',
                monitorId: monitor._id,
            };
            if (incidentStatus === 'resolved') {
                query = {
                    ...query,
                    'notificationOptions.incidentResolved': true,
                };
            } else if (incidentStatus === 'created') {
                query = {
                    ...query,
                    'notificationOptions.incidentCreated': true,
                };
            } else if (incidentStatus === 'acknowledged') {
                query = {
                    ...query,
                    'notificationOptions.incidentAcknowledged': true,
                };
            } else {
                return;
            }
            const integrations = await IntegrationService.findBy(query);
            const monitorStatus = await MonitorStatusService.findOneBy({
                monitorId: monitor._id,
            });
            // if (integrations.length === 0) deferred.resolve('no webhook added for this to notify');
            for (const integration of integrations) {
                response = await self.notify(
                    project,
                    monitor,
                    incident,
                    integration,
                    monitorStatus ? monitorStatus.status : null,
                    component,
                    duration
                );
            }
            return response;
        } catch (error) {
            ErrorService.log('WebHookService.sendNotification', error);
            throw error;
        }
    },

    // send notification to slack workspace channels
    async notify(project, monitor, incident, integration, monitorStatus, component, duration) {
        try {
            const uri = `${global.dashboardHost}/project/${component.projectId._id}/${component._id}/incidents/${incident._id}`;
            const yellow = '#fedc56';
            const green = '#028A0F';
            let payload;
            if (incident.resolved) {
                payload = {
                    attachments: [
                        {
                            color: green,
                            title: `Incident Resolved`,
                            title_link: uri,
                            text: `Incident on *${component.name} / ${
                                monitor.name
                                }* is resolved by ${
                                incident.resolvedBy
                                    ? incident.resolvedBy.name
                                    : 'Fyipe'
                                } after being ${
                                incident.incidentType
                                } for ${duration}`,
                        },
                    ],
                };
            } else if (incident.acknowledged) {
                payload = {
                    attachments: [
                        {
                            color: yellow,
                            title: `Incident Acknowledged`,
                            title_link: uri,
                            text: `Incident on *${component.name} / ${
                                monitor.name
                                }* is acknowledged by ${
                                incident.acknowledgedBy
                                    ? incident.acknowledgedBy.name
                                    : 'Fyipe'
                                } after being ${
                                incident.incidentType
                                } for ${duration}`,
                        },
                    ],
                };
            } else {
                payload = {
                    attachments: [
                        {
                            color:
                                incident.incidentType === 'online'
                                    ? green
                                    : incident.incidentType === 'degraded'
                                        ? yellow
                                        : '#f00',
                            title: `New ${incident.incidentType} incident for ${monitor.name}`,
                            title_link: uri,
                            fields: [
                                {
                                    title: 'Project Name:',
                                    value: project.name,
                                    short: true,
                                },
                                {
                                    title: 'Monitor Name:',
                                    value: `${component.name} / ${monitor.name}`,
                                    short: true,
                                },
                                ...(incident.title
                                    ? [
                                        {
                                            title: 'Incident Title:',
                                            value: incident.title,
                                            short: true,
                                        },
                                    ]
                                    : []),
                                ...(incident.description
                                    ? [
                                        {
                                            title: 'Incident Description:',
                                            value: incident.description,
                                            short: true,
                                        },
                                    ]
                                    : []),
                                ...(incident.incidentPriority
                                    ? [
                                        {
                                            title: 'Incident Priority:',
                                            value:
                                                incident.incidentPriority
                                                    .name,
                                            short: true,
                                        },
                                    ]
                                    : []),
                                {
                                    title: 'Created By:',
                                    value: incident.createdById
                                        ? incident.createdById.name
                                        : 'Fyipe',
                                    short: true,
                                },
                                {
                                    title: 'Incident Status:',
                                    value:
                                        incident.incidentType === 'online'
                                            ? 'Online'
                                            : incident.incidentType ===
                                                'degraded'
                                                ? 'Degraded'
                                                : 'Offline',
                                    short: true,
                                },
                            ],
                        },
                    ],
                };
            }
            const data = {
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
            if (integration.data.endpointType === 'get') {
                await axios.get(
                    integration.data.endpoint,
                    {
                        params: { ...data },
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                        },
                    }
                );

                return 'Webhook successfully pinged';
            } else if (integration.data.endpointType === 'post') {
                await axios.post(
                    integration.data.endpoint,
                    {
                        ...payload
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                        },
                    }
                );

                return 'Webhook successfully pinged';
            } else {
                const error = new Error('Webhook endpoint type missing');
                error.code = 400;
                ErrorService.log('WebHookService.notify', 'error');
                throw error;
            }
        } catch (error) {
            ErrorService.log('WebHookService.notify', 'error');
            throw error;
        }
    },
};

const IntegrationService = require('./integrationService');
const axios = require('axios');
const ProjectService = require('./projectService');
const MonitorStatusService = require('./monitorStatusService');
const ErrorService = require('./errorService');
