import IntegrationService from './IntegrationService';
import axios from 'axios';
import ObjectID from 'Common/Types/ObjectID';
import ProjectService from './ProjectService';
import {
    INCIDENT_RESOLVED,
    INCIDENT_CREATED,
    INCIDENT_ACKNOWLEDGED,
} from '../constants/incidentEvents';

export default class Service {
    // process messages to be sent to slack workspace channels
    async sendNotification(
        projectId: ObjectID,
        incident: $TSFixMe,
        monitor: $TSFixMe,
        incidentStatus: $TSFixMe,
        component: $TSFixMe,
        duration: $TSFixMe
    ): void {
        const self: $TSFixMe = this;
        let response: $TSFixMe;

        const project: $TSFixMe = await ProjectService.findOneBy({
            query: { _id: projectId },
            select: 'parentProject _id slug name',
        });
        if (project && project.parentProjectId) {
            projectId = project.parentProjectId._id || project.parentProjectId;
        }
        let query: $TSFixMe = {
            projectId: projectId,
            integrationType: 'slack',
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
        const select: $TSFixMe =
            'webHookName projectId createdById integrationType data monitors createdAt notificationOptions';
        const populate: $TSFixMe = [
            { path: 'createdById', select: 'name' },
            { path: 'projectId', select: 'name' },
            {
                path: 'monitors.monitorId',
                select: 'name',
                populate: [{ path: 'componentId', select: 'name' }],
            },
        ];
        const integrations: $TSFixMe = await IntegrationService.findBy({
            query,
            select,
            populate,
        });

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
    }

    // send notification to slack workspace channels
    async notify(
        project: $TSFixMe,
        monitor: $TSFixMe,
        incident: $TSFixMe,
        integration: $TSFixMe,
        component: $TSFixMe,
        duration: $TSFixMe
    ): void {
        const uri: string = `${global.dashboardHost}/project/${project.slug}/incidents/${incident._id}`;
        const yellow: string = '#fedc56';
        const green: string = '#028A0F';
        let payload: $TSFixMe;
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
                                : 'OneUptime'
                        } after being ${incident.incidentType} for ${duration}`,
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
                                : 'OneUptime'
                        } after being ${incident.incidentType} for ${duration}`,
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
                                          value: incident.incidentPriority.name,
                                          short: true,
                                      },
                                  ]
                                : []),
                            {
                                title: 'Created By:',
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
                        ],
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
    }

    async sendIncidentNoteNotification(
        projectId: ObjectID,
        incident: $TSFixMe,
        data: $TSFixMe,
        monitor: $TSFixMe
    ): void {
        const self: $TSFixMe = this;
        let response: $TSFixMe;

        const project: $TSFixMe = await ProjectService.findOneBy({
            query: { _id: projectId },
            select: 'parentProject _id slug',
        });
        if (project && project.parentProjectId) {
            projectId = project.parentProjectId._id || project.parentProjectId;
        }

        const query: $TSFixMe = {
            projectId: projectId,
            integrationType: 'slack',
            monitorId: monitor._id,
            'notificationOptions.incidentNoteAdded': true,
        };

        const select: $TSFixMe =
            'webHookName projectId createdById integrationType data monitors createdAt notificationOptions';
        const populate: $TSFixMe = [
            { path: 'createdById', select: 'name' },
            { path: 'projectId', select: 'name' },
            {
                path: 'monitors.monitorId',
                select: 'name',
                populate: [{ path: 'componentId', select: 'name' }],
            },
        ];

        const integrations: $TSFixMe = await IntegrationService.findBy({
            query,
            select,
            populate,
        });

        for (const integration of integrations) {
            response = await self.noteNotify(
                project,
                incident,
                integration,
                data,
                monitor
            );
        }
        return response;
    }

    // send notification to slack workspace channels when note is created
    async noteNotify(
        project: $TSFixMe,
        incident: $TSFixMe,
        integration: $TSFixMe,
        data: $TSFixMe,
        monitor: $TSFixMe
    ): void {
        const uri: string = `${global.dashboardHost}/project/${project.slug}/incidents/${incident._id}`;

        const payload: $TSFixMe = {
            attachments: [
                {
                    color: '#fedc56',
                    title: `Incident Note Created`,
                    title_link: uri,
                    text: `State:             ${data.incident_state}\nCreated By:   ${data.created_by}\nMonitor:        *${monitor.componentId.name} / ${monitor.name}*\nText:               ${data.content}`,
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
    }
}
