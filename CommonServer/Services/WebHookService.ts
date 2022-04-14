import IntegrationService from './IntegrationService';
import axios from 'axios';
import ProjectService from './ProjectService';
import MonitorStatusService from './MonitorStatusService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import {
    PROJECT_WEBHOOK,
    EXTERNAL_SUBSCRIBER_WEBHOOK,
} from '../constants/webHookTypes';
import ObjectID from 'Common/Types/ObjectID';
import {
    INCIDENT_RESOLVED,
    INCIDENT_ACKNOWLEDGED,
    INCIDENT_CREATED,
} from '../constants/incidentEvents';

export default class Service {
    // process external subscriber webhook
    async sendSubscriberNotification(
        subscriber: $TSFixMe,
        projectId: ObjectID,
        incident: $TSFixMe,
        monitor: $TSFixMe,
        component: $TSFixMe,
        duration: $TSFixMe,
        { note, incidentState, statusNoteStatus }: $TSFixMe = {}
    ): void {
        const [project, monitorStatus] = await Promise.all([
            ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'parentProjectId slug name _id',
            }),
            MonitorStatusService.findOneBy({
                query: { monitorId: monitor._id },
                select: 'status',
            }),
        ]);
        if (project && project.parentProjectId) {
            projectId = project.parentProjectId._id || project.parentProjectId;
        }

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
    }
    // process messages to be sent to slack workspace channels
    async sendIntegrationNotification(
        projectId: ObjectID,
        incident: $TSFixMe,
        monitor: $TSFixMe,
        incidentStatus: $TSFixMe,
        component: $TSFixMe,
        duration: $TSFixMe,
        { note, incidentState, statusNoteStatus }: $TSFixMe = {}
    ): void {
        const self = this;
        let response;

        const project = await ProjectService.findOneBy({
            query: { _id: projectId },
            select: 'parentProjectId slug name _id',
        });
        if (project && project.parentProjectId) {
            projectId = project.parentProjectId._id || project.parentProjectId;
        }
        let query = {
            projectId: projectId,
            integrationType: 'webhook',
            monitors: { $elemMatch: { monitorId: monitor._id } },
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
        const select =
            'webHookName projectId createdById integrationType data monitors createdAt notificationOptions';
        const populate = [
            { path: 'createdById', select: 'name' },
            { path: 'projectId', select: 'name' },
            {
                path: 'monitors.monitorId',
                select: 'name',
                populate: [{ path: 'componentId', select: 'name' }],
            },
        ];
        const [integrations, monitorStatus] = await Promise.all([
            IntegrationService.findBy({ query, select, populate }),
            MonitorStatusService.findOneBy({
                query: { monitorId: monitor._id },
                select: 'status',
            }),
        ]);
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
    }

    // send notification to slack workspace channels
    async notify(
        project: $TSFixMe,
        monitor: $TSFixMe,
        incident: $TSFixMe,
        webhookAgent: $TSFixMe,
        monitorStatus: $TSFixMe,
        component: $TSFixMe,
        duration: $TSFixMe,
        webHookType = PROJECT_WEBHOOK,
        { note, incidentState, statusNoteStatus }: $TSFixMe = {}
    ): void {
        const uri: string = `${global.dashboardHost}/project/${project.slug}/incidents/${incident._id}`;
        const yellow: string = '#fedc56';
        const green: string = '#028A0F';
        let payload;
        let webHookURL;
        let httpMethod;
        const isStatusPageNoteNotification =
            note && incidentState && statusNoteStatus;
        let notificationTitle = '';
        let notificationText = '';
        const criterionCauseName = incident.criterionCause
            ? incident.criterionCause.name
            : 'Unnamed Criterion';

        // set title and text for status note notifications
        if (isStatusPageNoteNotification) {
            notificationText = note;
            if (statusNoteStatus === 'created') {
                notificationTitle = `A new status note with status "${incidentState}" is created for incident #${incident.idNumber}`;
            } else if (statusNoteStatus === 'updated') {
                notificationTitle = `A status note is updated`;
            }
        }

        if (incident.resolved) {
            if (!isStatusPageNoteNotification) {
                notificationTitle = 'Incident Resolved';
                notificationText = `Incident on *${component.name} / ${
                    monitor.name
                }* is resolved by ${
                    incident.resolvedBy ? incident.resolvedBy.name : 'OneUptime'
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
                        criterion: criterionCauseName,
                    },
                ],
            };
        } else if (incident.acknowledged) {
            if (!isStatusPageNoteNotification) {
                notificationTitle = 'Incident Acknowledged';
                notificationText = `Incident on *${component.name} / ${
                    monitor.name
                }* is acknowledged by ${
                    incident.acknowledgedBy
                        ? incident.acknowledgedBy.name
                        : 'OneUptime'
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
                        criterion: criterionCauseName,
                    },
                ],
            };
        } else {
            if (!isStatusPageNoteNotification) {
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
                                          value: incident.incidentPriority.name,
                                          short: true,
                                      },
                                  ]
                                : []),
                            {
                                title: 'Cause:',
                                value: incident.createdById
                                    ? incident.createdById.name
                                    : 'OneUptime',
                                short: true,
                            },
                            {
                                title: 'Incident Status:',
                                value:
                                    incident.incidentType === 'online'
                                        ? 'Online'
                                        : incident.incidentType === 'degraded'
                                        ? 'Degraded'
                                        : 'Offline',
                                short: true,
                            },
                            {
                                title: 'Criterion:',
                                value: criterionCauseName,
                            },
                        ],
                    },
                ],
            };
        }

        const data: $TSFixMe = {
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
                : 'OneUptime',
            incidentStatus: incident.incidentType,
            monitorStatus,
            criterion: criterionCauseName,
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
                throw new BadDataException('Webhook endpoint type missing');
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
                    data:
                        httpMethod === 'post' ||
                        httpMethod === 'put' ||
                        httpMethod === 'patch'
                            ? payload
                            : null,
                    params:
                        httpMethod === 'get' || httpMethod === 'delete'
                            ? data
                            : null,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    timeout: 5000,
                })
                .then(response => response.status)
                .catch(() => {
                    return 500;
                });
            return response === 200;
        } else {
            return false;
        }
    }
}
