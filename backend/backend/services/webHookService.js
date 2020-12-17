module.exports = {
    // process external subscriber webhook
    sendSubscriberNotification: async function(
        subscriber,
        projectId,
        incident,
        monitor,
        component,
        duration,
        { note, incidentState, statusNoteStatus } = {}
    ) {
        try {
            const project = await ProjectService.findOneBy({ _id: projectId });
            if (project && project.parentProjectId) {
                projectId = project.parentProjectId._id;
            }
            const monitorStatus = await MonitorStatusService.findOneBy({
                monitorId: monitor._id,
            });

            return await this.notify(
                project,
                monitor,
                incident,
                subscriber,
                monitorStatus ? monitorStatus.status : null,
                component,
                duration,
                EXTERNAL_SUBSCRIBER_WEBHOOK,
                { note, incidentState, statusNoteStatus }
            );
        } catch (error) {
            ErrorService.log(
                'webHookService.sendSubscriberNotification',
                error
            );
        }
    },
    // process messages to be sent to slack workspace channels
    sendIntegrationNotification: async function(
        projectId,
        incident,
        monitor,
        incidentStatus,
        component,
        duration,
        { note, incidentState, statusNoteStatus } = {}
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
                    duration,
                    PROJECT_WEBHOOK,
                    {
                        note,
                        incidentState,
                        statusNoteStatus,
                    }
                );
            }
            return response;
        } catch (error) {
            ErrorService.log(
                'WebHookService.sendIntegrationNotification',
                error
            );
            throw error;
        }
    },

    // send notification to slack workspace channels
    async notify(
        project,
        monitor,
        incident,
        webhookAgent,
        monitorStatus,
        component,
        duration,
        webHookType = PROJECT_WEBHOOK,
        { note, incidentState, statusNoteStatus } = {}
    ) {
        try {
            const uri = `${global.dashboardHost}/project/${component.projectId._id}/${component._id}/incidents/${incident._id}`;
            const yellow = '#fedc56';
            const green = '#028A0F';
            let payload;
            let webHookURL;
            let httpMethod;
            const isStatusNoteNotifcation =
                note && incidentState && statusNoteStatus;
            let notificationTitle = '';
            let notificationText = '';

            // set title and text for status note notifications
            if (isStatusNoteNotifcation) {
                notificationText = note;
                if (statusNoteStatus === 'created') {
                    notificationTitle = `A new status note with status "${incidentState}" is crated for an incident`;
                } else if (statusNoteStatus === 'updated') {
                    notificationTitle = `A status note is updated`;
                }
            }

            if (incident.resolved) {
                if (!isStatusNoteNotifcation) {
                    notificationTitle = 'Incident Resolved';
                    notificationText = `Incident on *${component.name} / ${
                        monitor.name
                    }* is resolved by ${
                        incident.resolvedBy ? incident.resolvedBy.name : 'Fyipe'
                    } after being ${incident.incidentType} for ${duration}`;
                }

                payload = {
                    attachments: [
                        {
                            color: green,
                            title: notificationTitle,
                            title_link: uri,
                            incidentId: incident._id,
                            text: notificationText,
                        },
                    ],
                };
            } else if (incident.acknowledged) {
                if (!isStatusNoteNotifcation) {
                    notificationTitle = 'Incident Acknowledged';
                    notificationText = `Incident on *${component.name} / ${
                        monitor.name
                    }* is acknowledged by ${
                        incident.acknowledgedBy
                            ? incident.acknowledgedBy.name
                            : 'Fyipe'
                    } after being ${incident.incidentType} for ${duration}`;
                }

                payload = {
                    attachments: [
                        {
                            color: yellow,
                            title: notificationTitle,
                            title_link: uri,
                            incidentId: incident._id,
                            text: notificationText,
                        },
                    ],
                };
            } else {
                if (!isStatusNoteNotifcation) {
                    notificationTitle = 'New Incident Created';
                    notificationText = `New ${incident.incidentType} incident for ${monitor.name}`;
                }

                payload = {
                    attachments: [
                        {
                            color:
                                incident.incidentType === 'online'
                                    ? green
                                    : incident.incidentType === 'degraded'
                                    ? yellow
                                    : '#f00',

                            title: notificationTitle,
                            text: notificationText,

                            title_link: uri,
                            fields: [
                                {
                                    title: 'Incident ID:',
                                    value: incident._id,
                                    short: true,
                                },
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
                                    title: 'Cause:',
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
                title: notificationTitle,
                text: notificationText,
                monitorName: monitor.name,
                monitorId: monitor._id,
                projectId: project._id,
                incidentId: incident._id,
                projectName: project.name,
                createdAt: incident.createdAt,
                cause: incident.createdById
                    ? incident.createdById.name
                    : 'Fyipe',
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

            if (webHookType === PROJECT_WEBHOOK) {
                webHookURL = webhookAgent.data.endpoint;
                httpMethod = webhookAgent.data.endpointType;
                if (httpMethod === undefined) {
                    const error = new Error('Webhook endpoint type missing');
                    error.code = 400;
                    ErrorService.log('WebHookService.notify', 'error');
                    throw error;
                }
            } else if (webHookType === EXTERNAL_SUBSCRIBER_WEBHOOK) {
                webHookURL = webhookAgent.contactWebhook;
                httpMethod = webhookAgent.webhookMethod || 'post';
            }

            if (webHookURL && httpMethod) {
                const response = await axios
                    .request({
                        method: httpMethod,
                        url: webHookURL,
                        data: httpMethod === 'post' ? payload : null,
                        params: httpMethod === 'get' ? data : null,
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        timeout: 5000,
                    })
                    .then(response => response.status)
                    .catch(error => {
                        ErrorService.log('WebHookService.notify', error);
                        return 500;
                    });
                return response === 200;
            } else {
                return false;
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
const {
    PROJECT_WEBHOOK,
    EXTERNAL_SUBSCRIBER_WEBHOOK,
} = require('../constants/webHookTypes');
const {
    INCIDENT_RESOLVED,
    INCIDENT_ACKNOWLEDGED,
    INCIDENT_CREATED,
} = require('../constants/incidentEvents');
