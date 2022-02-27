export default {
    // process messages to be sent to slack workspace channels
    sendNotification: async function(
        projectId: $TSFixMe,
        incident: $TSFixMe,
        monitor: $TSFixMe,
        incidentStatus: $TSFixMe,
        component: $TSFixMe,
        duration: $TSFixMe
    ) {
        try {
            const self = this;
            let response;
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { _id: any; }; select: ... Remove this comment to see the full error message
            const project = await ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'parentProjectId slug name',
            });
            if (project && project.parentProjectId) {
                projectId =
                    project.parentProjectId._id || project.parentProjectId;
            }
            let query = {
                projectId: projectId,
                integrationType: 'msteams',
                monitors: { $elemMatch: { monitorId: monitor._id } },
            };
            if (incidentStatus === INCIDENT_RESOLVED) {
                query = {
                    ...query,
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ 'notificationOptions.incidentResolved': bo... Remove this comment to see the full error message
                    'notificationOptions.incidentResolved': true,
                };
            } else if (incidentStatus === INCIDENT_CREATED) {
                query = {
                    ...query,
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ 'notificationOptions.incidentCreated': boo... Remove this comment to see the full error message
                    'notificationOptions.incidentCreated': true,
                };
            } else if (incidentStatus === INCIDENT_ACKNOWLEDGED) {
                query = {
                    ...query,
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ 'notificationOptions.incidentAcknowledged'... Remove this comment to see the full error message
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
            const integrations = await IntegrationService.findBy({
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
        } catch (error) {
            ErrorService.log('msTeamsService.sendNotification', error);
            throw error;
        }
    },

    // send notification to slack workspace channels
    async notify(
        project: $TSFixMe,
        monitor: $TSFixMe,
        incident: $TSFixMe,
        integration: $TSFixMe,
        component: $TSFixMe,
        duration: $TSFixMe
    ) {
        try {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'dashboardHost' does not exist on type 'G... Remove this comment to see the full error message
            const uri = `${global.dashboardHost}/project/${project.slug}/incidents/${incident._id}`;
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
                                    : 'OneUptime'
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
                                    : 'OneUptime'
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
                                        : 'OneUptime',
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
    sendIncidentNoteNotification: async function(
        projectId: $TSFixMe,
        incident: $TSFixMe,
        data: $TSFixMe,
        monitor: $TSFixMe
    ) {
        try {
            const self = this;
            let response;
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { _id: any; }; select: ... Remove this comment to see the full error message
            const project = await ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'parentProjectId slug',
            });
            if (project && project.parentProjectId) {
                projectId =
                    project.parentProjectId._id || project.parentProjectId;
            }

            const query = {
                projectId: projectId,
                integrationType: 'msteams',
                monitorId: monitor._id,
                'notificationOptions.incidentNoteAdded': true,
            };

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

            const integrations = await IntegrationService.findBy({
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
        } catch (error) {
            ErrorService.log(
                'msTeamsService.sendIncidentNoteNotification',
                error
            );
            throw error;
        }
    },

    // send notification to slack workspace channels
    async noteNotify(
        project: $TSFixMe,
        incident: $TSFixMe,
        integration: $TSFixMe,
        data: $TSFixMe,
        monitor: $TSFixMe
    ) {
        try {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'dashboardHost' does not exist on type 'G... Remove this comment to see the full error message
            const uri = `${global.dashboardHost}/project/${project.slug}/incidents/${incident._id}`;
            const yellow = '#fedc56';
            const payload = {
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
        } catch (error) {
            ErrorService.log('msTeams.noteNotify', error);
            throw error;
        }
    },
};

import IntegrationService from './integrationService';
import axios from 'axios';
import ProjectService from './projectService';
import ErrorService from 'common-server/utils/error';
const {
    INCIDENT_RESOLVED,
    INCIDENT_CREATED,
    INCIDENT_ACKNOWLEDGED,
} = require('../constants/incidentEvents');
