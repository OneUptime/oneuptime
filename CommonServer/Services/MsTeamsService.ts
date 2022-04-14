import IntegrationService from './IntegrationService';
import axios from 'axios';
import ProjectService from './ProjectService';
import ObjectID from 'Common/Types/ObjectID';
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
        let response;

        const project: $TSFixMe = await ProjectService.findOneBy({
            query: { _id: projectId },
            select: 'parentProjectId slug name',
        });
        if (project && project.parentProjectId) {
            projectId = project.parentProjectId._id || project.parentProjectId;
        }
        let query = {
            projectId: projectId,
            integrationType: 'msteams',
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
                        activitySubtitle: `Incident on **${component.name} / ${
                            monitor.name
                        }** is resolved by ${
                            incident.resolvedBy
                                ? incident.resolvedBy.name
                                : 'OneUptime'
                        } after being ${incident.incidentType} for ${duration}`,
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
                        activitySubtitle: `Incident on **${component.name} / ${
                            monitor.name
                        }** is acknowledged by ${
                            incident.acknowledgedBy
                                ? incident.acknowledgedBy.name
                                : 'OneUptime'
                        } after being ${incident.incidentType} for ${duration}`,
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
                                    : 'OneUptime',
                            },
                            {
                                name: 'Incident Status:',
                                value:
                                    incident.incidentType === 'online'
                                        ? 'Online'
                                        : incident.incidentType === 'degraded'
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
    }

    async sendIncidentNoteNotification(
        projectId: ObjectID,
        incident: $TSFixMe,
        data: $TSFixMe,
        monitor: $TSFixMe
    ): void {
        const self: $TSFixMe = this;
        let response;

        const project: $TSFixMe = await ProjectService.findOneBy({
            query: { _id: projectId },
            select: 'parentProjectId slug',
        });
        if (project && project.parentProjectId) {
            projectId = project.parentProjectId._id || project.parentProjectId;
        }

        const query: $TSFixMe = {
            projectId: projectId,
            integrationType: 'msteams',
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

    // send notification to slack workspace channels
    async noteNotify(
        project: $TSFixMe,
        incident: $TSFixMe,
        integration: $TSFixMe,
        data: $TSFixMe,
        monitor: $TSFixMe
    ): void {
        const uri: string = `${global.dashboardHost}/project/${project.slug}/incidents/${incident._id}`;
        const yellow: string = '#fedc56';
        const payload: $TSFixMe = {
            '@context': 'https://schema.org/extensions',
            '@type': 'MessageCard',
            themeColor: yellow,
            summary: 'Incident Note Created',
            sections: [
                {
                    activityTitle: `[Incident Note Created](${uri})`,
                    activitySubtitle: `${monitor.componentId.name} / ${monitor.name}`,
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
    }
}
