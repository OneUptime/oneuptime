module.exports = {
    // process messages to be sent to slack workspace channels
    sendNotification: async function(
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
                integrationType: 'msteams',
                monitorId: monitor._id,
            };
            if (incidentStatus === INCIDENT_RESOLVED) {
                query = {
                    ...query,
                    'notificationOptions.incidentResolved': true,
                };
            } else if (incidentStatus === INCIDENT_CREATED) {
                query = {
                    ...query,
                    'notificationOptions.incidentCreated': true,
                };
            } else if (incidentStatus === INCIDENT_ACKNOWLEDGED) {
                query = {
                    ...query,
                    'notificationOptions.incidentAcknowledged': true,
                };
            } else {
                return;
            }
            const integrations = await IntegrationService.findBy(query);

            for (const integration of integrations) {
                response = await self.notify(
                    project,
                    monitor,
                    incident,
                    integration,
                    component,
                    duration
                );
            }
            return response;
        } catch (error) {
            ErrorService.log('msTeamsService.sendNotification', error);
            throw error;
        }
    },

    // send notification to slack workspace channels
    async notify(project, monitor, incident, integration, component, duration) {
        try {
            const uri = `${global.dashboardHost}/project/${component.projectId._id}/${component._id}/incidents/${incident._id}`;
            const yellow = '#fedc56';
            const green = '#028A0F';
            let payload;

            if (incident.resolved) {
                payload = {
                    '@context': 'https://schema.org/extensions',
                    '@type': 'MessageCard',
                    themeColor: green,
                    summary: 'Incident Resolved',
                    sections: [
                        {
                            activityTitle: `[Incident Resolved](${uri})`,
                            activitySubtitle: `Incident on **${
                                component.name
                            } / ${monitor.name}** is resolved by ${
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
                    '@context': 'https://schema.org/extensions',
                    '@type': 'MessageCard',
                    themeColor: yellow,
                    summary: 'Incident Acknowledged',
                    sections: [
                        {
                            activityTitle: `[Incident Acknowledged](${uri})`,
                            activitySubtitle: `Incident on **${
                                component.name
                            } / ${monitor.name}** is acknowledged by ${
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
                    '@context': 'https://schema.org/extensions',
                    '@type': 'MessageCard',
                    themeColor:
                        incident.incidentType === 'online'
                            ? green
                            : incident.incidentType === 'degraded'
                            ? yellow
                            : '#f00',
                    summary: 'Incident',
                    sections: [
                        {
                            activityTitle: `[New ${incident.incidentType} incident for ${monitor.name}](${uri})`,
                            facts: [
                                {
                                    name: 'Project Name:',
                                    value: project.name,
                                },
                                {
                                    name: 'Monitor Name:',
                                    value: `${component.name} / ${monitor.name}`,
                                },
                                ...(incident.title
                                    ? [
                                          {
                                              name: 'Incident Title:',
                                              value: `${incident.title}`,
                                          },
                                      ]
                                    : []),
                                ...(incident.description
                                    ? [
                                          {
                                              name: 'Incident Description:',
                                              value: `${incident.description}`,
                                          },
                                      ]
                                    : []),
                                ...(incident.incidentPriority
                                    ? [
                                          {
                                              name: 'Incident Priority:',
                                              value: `${incident.incidentPriority.name}`,
                                          },
                                      ]
                                    : []),
                                {
                                    name: 'Created By:',
                                    value: incident.createdById
                                        ? incident.createdById.name
                                        : 'Fyipe',
                                },
                                {
                                    name: 'Incident Status:',
                                    value:
                                        incident.incidentType === 'online'
                                            ? 'Online'
                                            : incident.incidentType ===
                                              'degraded'
                                            ? 'Degraded'
                                            : 'Offline',
                                },
                            ],
                            markdown: true,
                        },
                    ],
                };
            }
            await axios.post(
                integration.data.endpoint,
                {
                    ...payload,
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                }
            );

            return 'Webhook successfully pinged';
        } catch (error) {
            ErrorService.log('msTeams.notify', error);
            throw error;
        }
    },
    sendIncidentNoteNotification: async function(projectId, incident, data) {
        try {
            const self = this;
            let response;
            const project = await ProjectService.findOneBy({ _id: projectId });
            if (project && project.parentProjectId) {
                projectId = project.parentProjectId._id;
            }

            let query = {
                projectId: projectId,
                integrationType: 'msteams',
                monitorId: incident.monitorId._id,
                'notificationOptions.incidentNoteAdded': true,
            };

            const integrations = await IntegrationService.findBy(query);

            for (const integration of integrations) {
                response = await self.noteNotify(
                    project,
                    incident,
                    integration,
                    data
                );
            }
            return response;
        } catch (error) {
            ErrorService.log(
                'msTeamsService.sendIncidentNoteNotification',
                error
            );
            throw error;
        }
    },

    // send notification to slack workspace channels
    async noteNotify(project, incident, integration, data) {
        try {
            const uri = `${global.dashboardHost}/project/${project.slug}/${integration.monitorId.componentId._id}/incidents/${incident._id}`;
            let payload;
            const yellow = '#fedc56';

            payload = {
                '@context': 'https://schema.org/extensions',
                '@type': 'MessageCard',
                themeColor: yellow,
                summary: 'Incident Note Created',
                sections: [
                    {
                        activityTitle: `[Incident Note Created](${uri})`,
                        activitySubtitle: `${incident.monitorId.componentId.name} / ${incident.monitorId.name}`,
                        facts: [
                            { Name: 'State', value: `${data.incident_state}` },
                            { Name: 'Created By', value: `${data.created_by}` },
                            { Name: 'Text', value: `${data.content}` },
                        ],
                    },
                ],
            };

            await axios.post(
                integration.data.endpoint,
                {
                    ...payload,
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                }
            );

            return 'Webhook successfully pinged';
        } catch (error) {
            ErrorService.log('msTeams.noteNotify', error);
            throw error;
        }
    },
};

const IntegrationService = require('./integrationService');
const axios = require('axios');
const ProjectService = require('./projectService');
const ErrorService = require('./errorService');
const {
    INCIDENT_RESOLVED,
    INCIDENT_CREATED,
    INCIDENT_ACKNOWLEDGED,
} = require('../constants/incidentEvents');
