import PositiveNumber from 'Common/Types/PositiveNumber';
import IncidentModel from '../Models/incident';
import ObjectID from 'Common/Types/ObjectID';
import IncidentTimelineService from './IncidentTimelineService';
import MonitorService from './MonitorService';
import AlertService from './AlertService';
import RealTimeService from './realTimeService';
import NotificationService from './NotificationService';
import WebHookService from './WebHookService';
import MsTeamsService from './MsTeamsService';
import SlackService from './SlackService';
import ZapierService from './ZapierService';
import ProjectService from './ProjectService';
import MonitorStatusService from './MonitorStatusService';
import ComponentService from './ComponentService';
import IncidentSettingsService from './IncidentSettingsService';
import Handlebars from 'handlebars';
import Moment from 'moment';
import IncidentMessageService from './IncidentMessageService';
import {
    INCIDENT_CREATED,
    INCIDENT_ACKNOWLEDGED,
    INCIDENT_RESOLVED,
} from '../constants/incidentEvents';
import IncidentUtilitiy from '../Utils/incident';
import IncidentCommunicationSlaService from './IncidentCommunicationSlaService';

import { isEmpty } from 'lodash';
import joinNames from '../Utils/joinNames';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';
import getSlug from '../Utils/getSlug';

export default class Service {
    async findBy({ query, limit, skip, populate, select, sort }: FindBy): void {
        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const incidentQuery: $TSFixMe = IncidentModel.find(query)
            .lean()
            .limit(limit.toNumber())
            .skip(skip.toNumber())
            .sort(sort);

        incidentQuery.select(select);
        incidentQuery.populate(populate);

        const incidents: $TSFixMe = await incidentQuery;
        return incidents;
    }

    async create(data: $TSFixMe): void {
        if (!data.monitors || data.monitors.length === 0) {
            const error: $TSFixMe = new Error(
                'You need at least one monitor to create an incident'
            );

            error.code = 400;
            throw error;
        }
        if (!isArrayUnique(data.monitors)) {
            const error: $TSFixMe = new Error(
                'You cannot have multiple selection of the same monitor'
            );

            error.code = 400;
            throw error;
        }

        let monitors: $TSFixMe = await MonitorService.findBy({
            query: { _id: { $in: data.monitors } },
            select: 'disabled name _id shouldNotMonitor',
        });
        monitors = monitors.filter((monitor: $TSFixMe) => {
            return !monitor.disabled;
        });
        if (monitors.length === 0) {
            const error: $TSFixMe = new Error(
                'You need at least one enabled monitor to create an incident'
            );

            error.code = 400;
            throw error;
        }
        const monitorNames: $TSFixMe = monitors.map((monitor: $TSFixMe) => {
            return monitor.name;
        });
        monitors = monitors
            .filter((monitor: $TSFixMe) => {
                return !monitor.shouldNotMonitor;
            })
            .map((monitor: $TSFixMe) => {
                return {
                    monitorId: monitor._id,
                };
            });
        if (monitors.length === 0) {
            const error: $TSFixMe = new Error(
                'You need at least one monitor not undergoing scheduled maintenance'
            );

            error.code = 400;
            throw error;
        }
        if (monitors && monitors.length > 0) {
            const { matchedCriterion }: $TSFixMe = data;

            const project: $TSFixMe = await ProjectService.findOneBy({
                query: { _id: data.projectId },
                select: 'users parentProjectId name',
            });
            const users: $TSFixMe =
                project && project.users && project.users.length
                    ? project.users.map(({ userId }: $TSFixMe) => {
                          return userId;
                      })
                    : [];

            let errorMsg: $TSFixMe;
            if (data.customFields && data.customFields.length > 0) {
                for (const field of data.customFields) {
                    if (
                        field.uniqueField &&
                        field.fieldValue &&
                        field.fieldValue.trim()
                    ) {
                        const incident: $TSFixMe = await this.findOneBy({
                            query: {
                                customFields: {
                                    $elemMatch: {
                                        fieldName: field.fieldName,
                                        fieldType: field.fieldType,
                                        fieldValue: field.fieldValue,
                                    },
                                },
                            },
                            select: '_id',
                        });

                        if (incident) {
                            errorMsg = `The field ${field.fieldName} must be unique for all incidents`;
                        }
                    }
                }
            }

            if (errorMsg) {
                const error: $TSFixMe = new Error(errorMsg);

                error.code = 400;
                throw error;
            }

            let incident: $TSFixMe = new IncidentModel();
            let parentCount: $TSFixMe = 0,
                deletedParentCount = 0;
            if (project && project.parentProjectId) {
                const [pCount, dpCount]: $TSFixMe = await Promise.all([
                    this.countBy({
                        projectId:
                            project.parentProjectId._id ||
                            project.parentProjectId,
                    }),
                    this.countBy({
                        projectId:
                            project.parentProjectId._id ||
                            project.parentProjectId,
                        deleted: true,
                    }),
                ]);
                parentCount = pCount;
                deletedParentCount = dpCount;
            }
            const [
                incidentsCountInProject,
                deletedIncidentsCountInProject,
            ]: $TSFixMe = await Promise.all([
                this.countBy({
                    projectId: data.projectId,
                }),
                this.countBy({
                    projectId: data.projectId,
                    deleted: true,
                }),
            ]);

            incident.projectId = data.projectId || null;

            incident.monitors = monitors;

            incident.createdById = data.createdById;

            incident.createdByApi = data.createdByApi;

            incident.notClosedBy = users;

            incident.incidentType = data.incidentType;

            incident.manuallyCreated = data.manuallyCreated || false;
            if (data.reason && data.reason.length > 0) {
                incident.reason = data.reason.join('\n');
            }

            incident.response = data.response || null;

            incident.idNumber =
                incidentsCountInProject +
                deletedIncidentsCountInProject +
                parentCount +
                deletedParentCount +
                1;

            incident.slug = getSlug(incident.idNumber); // create incident slug from the idNumber

            incident.customFields = data.customFields;

            incident.createdByIncomingHttpRequest =
                data.createdByIncomingHttpRequest;

            const templatesInput: $TSFixMe = {
                incidentType: data.incidentType,
                projectName: project?.name,
                time: Moment().format('h:mm:ss a'),
                date: Moment().format('MMM Do YYYY'),
                monitorName: joinNames(monitorNames),
            };

            if (!incident.manuallyCreated) {
                const select: $TSFixMe =
                    'projectId title description incidentPriority isDefault name';
                const query: $TSFixMe = {
                    projectId: data.projectId,
                    isDefault: true,
                };
                const incidentSettings: $TSFixMe =
                    await IncidentSettingsService.findOne({
                        query,
                        select,
                    });

                const titleTemplate: $TSFixMe = Handlebars.compile(
                    incidentSettings.title
                );
                const descriptionTemplate: $TSFixMe = Handlebars.compile(
                    incidentSettings.description
                );

                incident.title =
                    matchedCriterion && matchedCriterion.title
                        ? matchedCriterion.title
                        : titleTemplate(templatesInput);

                incident.description =
                    matchedCriterion && matchedCriterion.description
                        ? matchedCriterion.description
                        : descriptionTemplate(templatesInput);

                incident.criterionCause = {
                    ...matchedCriterion,
                };

                incident.incidentPriority = incidentSettings.incidentPriority;

                if (data.probeId) {
                    incident.probes = [
                        {
                            probeId: data.probeId,
                            updatedAt: Date.now(),
                            status: true,
                            reportedStatus: data.incidentType,
                        },
                    ];
                }
            } else {
                const titleTemplate: $TSFixMe = Handlebars.compile(data.title);
                const descriptionTemplate: $TSFixMe = Handlebars.compile(
                    data.description
                );

                incident.title = titleTemplate(templatesInput);

                incident.description = descriptionTemplate(templatesInput);

                incident.incidentPriority = data.incidentPriority;
            }

            incident = await incident.save();

            // update all monitor status in the background to match incident type
            MonitorService.updateAllMonitorStatus(
                { _id: { $in: data.monitors } },
                { monitorStatus: data.incidentType.toLowerCase() }
            );

            // ********* TODO ************
            // notification is an array of notifications
            // ***************************

            let populate: $TSFixMe = [
                {
                    path: 'monitors.monitorId',
                    select: 'name slug componentId projectId type',
                    populate: [
                        { path: 'componentId', select: 'name slug' },
                        { path: 'projectId', select: 'name slug' },
                    ],
                },
                { path: 'createdById', select: 'name' },
                { path: 'projectId', select: 'name slug' },
                { path: 'resolvedBy', select: 'name' },
                { path: 'acknowledgedBy', select: 'name' },
                { path: 'incidentPriority', select: 'name' },
            ];
            let select: $TSFixMe =
                'slug idNumber notifications _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted';
            const populatedIncident: $TSFixMe = await this.findOneBy({
                query: { _id: incident._id },
                populate,
                select,
            });
            const notifications: $TSFixMe =
                await this._sendIncidentCreatedAlert(populatedIncident);

            incident.notifications = notifications.map(
                (notification: $TSFixMe) => {
                    return {
                        notificationId: notification._id,
                    };
                }
            );
            incident = await incident.save();

            populate = [
                {
                    path: 'monitors.monitorId',
                    select: 'name slug componentId projectId type',
                    populate: [
                        { path: 'componentId', select: 'name slug' },
                        { path: 'projectId', select: 'name slug' },
                    ],
                },
                { path: 'createdById', select: 'name' },
                { path: 'projectId', select: 'name slug' },
                { path: 'resolvedBy', select: 'name' },
                { path: 'acknowledgedBy', select: 'name' },
                { path: 'incidentPriority', select: 'name color' },
                {
                    path: 'acknowledgedByIncomingHttpRequest',
                    select: 'name',
                },
                { path: 'resolvedByIncomingHttpRequest', select: 'name' },
                { path: 'createdByIncomingHttpRequest', select: 'name' },
                {
                    path: 'probes.probeId',
                    select: 'probeName _id probeImage',
                },
            ];
            select =
                'slug notifications reason acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';
            incident = await this.findOneBy({
                query: { _id: incident._id },
                select,
                populate,
            });

            RealTimeService.sendCreatedIncident(incident);

            IncidentMessageService.create({
                content: incident.description,
                incidentId: incident._id,

                createdById: incident.createdById?._id || incident.createdById,
                type: 'investigation',
                incident_state: 'Identified',
                post_statuspage: true,
            });

            await IncidentTimelineService.create({
                incidentId: incident._id,
                createdById: data.createdById,
                probeId: data.probeId,
                status: data.incidentType,
                createdByApi: data.createdByApi,
            });

            // ********* TODO ************
            // handle multiple monitors for this
            // it should now accept array of monitors id
            // ***************************
            this.startInterval(data.projectId, monitors, incident);

            return incident;
        }
    }

    async countBy(query: Query): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        const count: $TSFixMe = await IncidentModel.countDocuments(query);
        return count;
    }

    async deleteBy(query: Query, userId: ObjectID): void {
        if (!query) {
            query = {};
        }

        query['deleted'] = false;
        const incident: $TSFixMe = await IncidentModel.findOneAndUpdate(query, {
            $set: {
                deleted: true,
                deletedAt: Date.now(),
                deletedById: userId,
            },
        });

        if (incident) {
            this.clearInterval(incident._id); // clear any existing sla interval

            const monitorStatuses: $TSFixMe = await MonitorStatusService.findBy(
                {
                    query: { incidentId: incident._id },
                    select: '_id',
                }
            );
            for (const monitorStatus of monitorStatuses) {
                const { _id }: $TSFixMe = monitorStatus;
                await MonitorStatusService.deleteBy({ _id }, userId);
            }

            const monitors: $TSFixMe = incident.monitors.map(
                (monitor: $TSFixMe) => {
                    return monitor.monitorId._id || monitor.monitorId;
                }
            );

            // update all monitor status in the background to match incident type
            MonitorService.updateAllMonitorStatus(
                { _id: { $in: monitors } },
                { monitorStatus: 'online' }
            );

            const populateIncTimeline: $TSFixMe = [
                { path: 'createdById', select: 'name' },
                {
                    path: 'probeId',
                    select: 'probeName probeImage',
                },
            ];
            const selectIncTimeline: $TSFixMe =
                'incidentId createdById probeId createdByZapier createdAt status incident_state';
            const incidentTimeline: $TSFixMe =
                await IncidentTimelineService.findBy({
                    query: { incidentId: incident._id },
                    select: selectIncTimeline,
                    populate: populateIncTimeline,
                });
            for (const event of incidentTimeline) {
                await IncidentTimelineService.deleteBy(
                    { _id: event._id },
                    userId
                );
            }
        }
        return incident;
    }

    // Description: Get Incident by incident Id.
    // Params:
    // Param 1: monitorId: monitor Id
    // Returns: promise with incident or error.
    async findOneBy({ query, populate, select, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }

        query['deleted'] = false;

        const incidentQuery: $TSFixMe = IncidentModel.findOne(query)
            .sort(sort)
            .lean();

        incidentQuery.select(select);
        incidentQuery.populate(populate);

        const incident: $TSFixMe = await incidentQuery;
        return incident;
    }

    async updateOneBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const oldIncident: $TSFixMe = await this.findOneBy({
            query: { _id: query._id, deleted: { $ne: null } },
            select: 'notClosedBy manuallyCreated',
        });

        const notClosedBy: $TSFixMe = oldIncident && oldIncident.notClosedBy;
        if (data.notClosedBy) {
            data.notClosedBy = notClosedBy.concat(data.notClosedBy);
        }
        data.manuallyCreated =
            data.manuallyCreated ||
            (oldIncident && oldIncident.manuallyCreated) ||
            false;

        if (
            data.reason &&
            Array.isArray(data.reason) &&
            data.reason.length > 0
        ) {
            data.reason = data.reason.join('\n');
        }

        let updatedIncident: $TSFixMe = await IncidentModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            { new: true }
        );

        const populate: $TSFixMe = [
            {
                path: 'monitors.monitorId',
                select: 'name slug componentId projectId type',
                populate: [
                    { path: 'componentId', select: 'name slug' },
                    { path: 'projectId', select: 'name slug' },
                ],
            },
            { path: 'createdById', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'resolvedBy', select: 'name' },
            { path: 'acknowledgedBy', select: 'name' },
            { path: 'incidentPriority', select: 'name color' },
            {
                path: 'acknowledgedByIncomingHttpRequest',
                select: 'name',
            },
            { path: 'resolvedByIncomingHttpRequest', select: 'name' },
            { path: 'createdByIncomingHttpRequest', select: 'name' },
            { path: 'probes.probeId', select: 'probeName _id probeImage' },
        ];
        const select: $TSFixMe =
            'slug notifications reason response hideIncident acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

        updatedIncident = await this.findOneBy({
            query: { _id: updatedIncident._id },
            select,
            populate,
        });

        RealTimeService.updateIncident(updatedIncident);

        return updatedIncident;
    }

    async updateBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        let updatedData: $TSFixMe = await IncidentModel.updateMany(query, {
            $set: data,
        });

        const populate: $TSFixMe = [
            {
                path: 'monitors.monitorId',
                select: 'name slug componentId projectId type',
                populate: [
                    { path: 'componentId', select: 'name slug' },
                    { path: 'projectId', select: 'name slug' },
                ],
            },
            { path: 'createdById', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'resolvedBy', select: 'name' },
            { path: 'acknowledgedBy', select: 'name' },
            { path: 'incidentPriority', select: 'name color' },
            {
                path: 'acknowledgedByIncomingHttpRequest',
                select: 'name',
            },
            { path: 'resolvedByIncomingHttpRequest', select: 'name' },
            { path: 'createdByIncomingHttpRequest', select: 'name' },
            { path: 'probes.probeId', select: 'probeName _id probeImage' },
        ];
        const select: $TSFixMe =
            'slug notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

        updatedData = await this.findBy({ query, populate, select });
        return updatedData;
    }

    async _sendIncidentCreatedAlert(incident: $TSFixMe): void {
        ZapierService.pushToZapier('incident_created', incident);
        // await RealTimeService.sendCreatedIncident(incident);

        const notifications: $TSFixMe = [];

        const monitors: $TSFixMe = incident.monitors.map(
            (monitor: $TSFixMe) => {
                return monitor.monitorId;
            }
        );

        // handle this asynchronous operation in the background
        AlertService.sendCreatedIncidentToSubscribers(incident, monitors);

        for (const monitor of monitors) {
            AlertService.sendCreatedIncident(incident, monitor);

            let notification: $TSFixMe = {};
            // send slack notification

            SlackService.sendNotification(
                incident.projectId._id || incident.projectId,
                incident,
                monitor,
                INCIDENT_CREATED,
                monitor.componentId
            );
            // send webhook notification

            WebHookService.sendIntegrationNotification(
                incident.projectId._id || incident.projectId,
                incident,
                monitor,
                INCIDENT_CREATED,
                monitor.componentId
            );
            // send Ms Teams notification

            MsTeamsService.sendNotification(
                incident.projectId._id || incident.projectId,
                incident,
                monitor,
                INCIDENT_CREATED,
                monitor.componentId
            );

            const meta: $TSFixMe = {
                type: 'Incident',
                componentId: monitor.componentId._id || monitor.componentId,
                incidentId: incident._id,
            };

            if (!incident.createdById) {
                if (incident.createdByIncomingHttpRequest) {
                    const msg: string = `New ${incident.incidentType} Incident was created for ${monitor.name} by Incoming HTTP Request`;
                    notification = await NotificationService.create(
                        incident.projectId._id || incident.projectId,
                        msg,
                        'incoming http request',
                        'warning',
                        meta
                    );
                } else {
                    const msg: string = `New ${incident.incidentType} Incident was created for ${monitor.name} by OneUptime`;
                    notification = await NotificationService.create(
                        incident.projectId._id || incident.projectId,
                        msg,
                        'oneuptime',
                        'warning',
                        meta
                    );
                }
            } else {
                const msg: string = `New ${incident.incidentType} Incident was created for ${monitor.name} by ${incident.createdById.name}`;
                notification = await NotificationService.create(
                    incident.projectId._id || incident.projectId,
                    msg,
                    incident.createdById.name,
                    'warning',
                    meta
                );
            }

            notifications.push(notification);
        }
        return notifications;
    }

    /**
     * @param {object} incidentId incident id
     * @param {string} userId Id of user performing the action.
     * @param {string} name Name of user performing the action.
     * @returns {object} Promise with incident or error.
     */
    async acknowledge(
        incidentId: $TSFixMe,
        userId: ObjectID,
        name: $TSFixMe,
        probeId: $TSFixMe,
        zapier: $TSFixMe,
        httpRequest = {},
        acknowledgedByApi = false
    ): void {
        let incident: $TSFixMe = await this.findOneBy({
            query: { _id: incidentId, acknowledged: false },
            select: '_id',
        });
        if (incident) {
            incident = await this.updateOneBy(
                {
                    _id: incident._id,
                },
                {
                    acknowledged: true,
                    acknowledgedBy: userId,
                    acknowledgedAt: Date.now(),
                    acknowledgedByZapier: zapier,

                    acknowledgedByIncomingHttpRequest: httpRequest?._id,
                    acknowledgedByApi,
                }
            );

            const downtimestring: $TSFixMe =
                IncidentUtilitiy.calculateHumanReadableDownTime(
                    incident.createdAt
                );

            if (isEmpty(httpRequest)) {
                NotificationService.create(
                    incident.projectId._id || incident.projectId,
                    `An Incident was acknowledged by ${name}`,
                    userId,
                    'acknowledge'
                );
            } else {
                NotificationService.create(
                    incident.projectId._id || incident.projectId,

                    `An Incident was acknowledged by an incoming HTTP request ${httpRequest.name}`,
                    userId,
                    'acknowledge'
                );
            }

            // Ping webhook
            const monitors: $TSFixMe = incident.monitors.map(
                (monitor: $TSFixMe) => {
                    return monitor.monitorId;
                }
            );

            // assuming all the monitors in the incident is from the same component
            // which makes sense, since having multiple component will make things more complicated

            const populateComponent: $TSFixMe = [
                { path: 'projectId', select: 'name' },
                { path: 'componentCategoryId', select: 'name' },
            ];

            const selectComponent: $TSFixMe =
                '_id createdAt name createdById projectId slug componentCategoryId';
            const component: $TSFixMe = await ComponentService.findOneBy({
                query: {
                    _id:
                        monitors[0] &&
                        monitors[0].componentId &&
                        monitors[0].componentId._id
                            ? monitors[0].componentId._id
                            : monitors[0].componentId,
                },
                select: selectComponent,
                populate: populateComponent,
            });

            // automatically create acknowledgement incident note
            IncidentMessageService.create({
                content: 'This incident has been acknowledged',
                incidentId,
                createdById: userId,
                type: 'investigation',
                incident_state: 'Acknowledged',
                post_statuspage: true,
                monitors,
                ignoreCounter: true,
            });

            await IncidentTimelineService.create({
                incidentId: incidentId,
                createdById: userId,
                probeId: probeId,
                createdByZapier: zapier,
                status: 'acknowledged',
                createdByApi: acknowledgedByApi,
            });

            this.refreshInterval(incidentId);

            AlertService.sendAcknowledgedIncidentToSubscribers(
                incident,
                monitors
            );

            for (const monitor of monitors) {
                WebHookService.sendIntegrationNotification(
                    incident.projectId._id || incident.projectId,
                    incident,
                    monitor,
                    INCIDENT_ACKNOWLEDGED,
                    component,
                    downtimestring
                );

                SlackService.sendNotification(
                    incident.projectId._id || incident.projectId,
                    incident,
                    monitor,
                    INCIDENT_ACKNOWLEDGED,
                    component,
                    downtimestring
                );

                MsTeamsService.sendNotification(
                    incident.projectId._id || incident.projectId,
                    incident,
                    monitor,
                    INCIDENT_ACKNOWLEDGED,
                    component,
                    downtimestring
                );

                AlertService.sendAcknowledgedIncidentMail(incident, monitor);
            }

            ZapierService.pushToZapier('incident_acknowledge', incident);

            RealTimeService.incidentAcknowledged(incident);
        } else {
            const populate: $TSFixMe = [
                {
                    path: 'monitors.monitorId',
                    select: 'name slug componentId projectId type',
                    populate: [
                        { path: 'componentId', select: 'name slug' },
                        { path: 'projectId', select: 'name slug' },
                    ],
                },
                { path: 'createdById', select: 'name' },
                { path: 'projectId', select: 'name slug' },
                { path: 'resolvedBy', select: 'name' },
                { path: 'acknowledgedBy', select: 'name' },
                { path: 'incidentPriority', select: 'name color' },
                {
                    path: 'acknowledgedByIncomingHttpRequest',
                    select: 'name',
                },
                { path: 'resolvedByIncomingHttpRequest', select: 'name' },
                { path: 'createdByIncomingHttpRequest', select: 'name' },
                {
                    path: 'probes.probeId',
                    select: 'probeName _id probeImage',
                },
            ];
            const select: $TSFixMe =
                'slug notifications reason response acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

            incident = await this.findOneBy({
                query: { _id: incidentId, acknowledged: true },
                populate,
                select,
            });
        }

        return incident;
    }

    // Description: Update user who resolved incident.
    // Params:
    // Param 1: data: {incidentId}
    // Returns: promise with incident or error.
    async resolve(
        incidentId: $TSFixMe,
        userId: ObjectID,
        name: $TSFixMe,
        probeId: $TSFixMe,
        zapier: $TSFixMe,
        httpRequest = {},
        resolvedByApi = false
    ): void {
        const data: $TSFixMe = {};
        let incident: $TSFixMe = await this.findOneBy({
            query: { _id: incidentId },
            select: '_id acknowledged',
        });

        if (!incident) {
            return;
        }

        if (!incident.acknowledged) {
            data.acknowledged = true;

            data.acknowledgedBy = userId;

            data.acknowledgedAt = Date.now();

            data.acknowledgedByZapier = zapier;

            data.acknowledgedByIncomingHttpRequest = httpRequest?._id;

            data.acknowledgedByApi = resolvedByApi;

            await IncidentTimelineService.create({
                incidentId: incidentId,
                createdById: userId,
                probeId: probeId,
                createdByZapier: zapier,
                status: 'acknowledged',
                createdByApi: resolvedByApi,
            });
        }

        data.resolved = true;

        data.resolvedBy = userId;

        data.resolvedAt = Date.now();

        data.resolvedByZapier = zapier;

        data.resolvedByIncomingHttpRequest = httpRequest?._id;

        data.resolvedByApi = resolvedByApi;

        incident = await this.updateOneBy({ _id: incidentId }, data);

        const monitors: $TSFixMe = incident.monitors.map(
            (monitor: $TSFixMe) => {
                return monitor.monitorId._id || monitor.monitorId;
            }
        );

        // update all monitor status in the background to match incident type
        MonitorService.updateAllMonitorStatus(
            { _id: { $in: monitors } },
            { monitorStatus: 'online' }
        );

        // automatically create resolved incident note
        await IncidentMessageService.create({
            content: 'This incident has been resolved',
            incidentId,
            createdById: userId,
            type: 'investigation',
            incident_state: 'Resolved',
            post_statuspage: true,
            monitors,
            ignoreCounter: true,
        });

        await IncidentTimelineService.create({
            incidentId: incidentId,
            createdById: userId,
            probeId: probeId,
            createdByZapier: zapier,
            status: 'resolved',
            createdByApi: resolvedByApi,
        });

        this.clearInterval(incidentId);

        const statusData: $TSFixMe = [];
        // send notificaton to subscribers
        AlertService.sendResolvedIncidentToSubscribers(incident, monitors);
        for (const monitor of monitors) {
            if (incident.probes && incident.probes.length > 0) {
                for (const probe of incident.probes) {
                    statusData.push({
                        monitorId: monitor._id,
                        probeId: probe.probeId ? probe.probeId._id : null,
                        manuallyCreated: userId ? true : false,
                        status: 'online',
                    });
                }
            } else {
                statusData.push({
                    monitorId: monitor._id,
                    probeId,
                    manuallyCreated: userId ? true : false,
                    status: 'online',
                });
            }

            // run this in the background
            this.sendIncidentResolvedNotification(incident, name, monitor);
        }
        await MonitorStatusService.createMany(statusData);

        RealTimeService.incidentResolved(incident);

        ZapierService.pushToZapier('incident_resolve', incident);

        return incident;
    }

    //
    async close(incidentId: $TSFixMe, userId: ObjectID): void {
        const incident: $TSFixMe = await IncidentModel.findByIdAndUpdate(
            incidentId,
            {
                $pull: { notClosedBy: userId },
            }
        );

        return incident;
    }

    async getUnresolvedIncidents(
        subProjectIds: $TSFixMe,
        userId: ObjectID,
        isHome = false
    ): void {
        let incidentsUnresolved: $TSFixMe = await this.findBy({
            query: { projectId: { $in: subProjectIds }, resolved: false },
            select: '_id notClosedBy',
        });
        incidentsUnresolved = incidentsUnresolved.map((incident: $TSFixMe) => {
            if (incident.notClosedBy.indexOf(userId) < 0) {
                return this.updateOneBy(
                    { _id: incident._id },
                    { notClosedBy: [userId] }
                );
            } else {
                return incident;
            }
        });
        await Promise.all(incidentsUnresolved);
        const populate: $TSFixMe = [
            {
                path: 'monitors.monitorId',
                select: 'name slug componentId projectId type',
                populate: [
                    { path: 'componentId', select: 'name slug' },
                    { path: 'projectId', select: 'name slug' },
                ],
            },
            { path: 'createdById', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'resolvedBy', select: 'name' },
            { path: 'acknowledgedBy', select: 'name' },
            { path: 'incidentPriority', select: 'name color' },
            {
                path: 'acknowledgedByIncomingHttpRequest',
                select: 'name',
            },
            { path: 'resolvedByIncomingHttpRequest', select: 'name' },
            { path: 'createdByIncomingHttpRequest', select: 'name' },
            { path: 'probes.probeId', select: 'probeName _id probeImage' },
        ];
        const select: $TSFixMe =
            'slug createdAt notifications reason response acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

        incidentsUnresolved = await this.findBy({
            query: { projectId: { $in: subProjectIds }, resolved: false },
            populate,
            select,
        });
        const incidentsResolved: $TSFixMe = await this.findBy({
            query: {
                projectId: { $in: subProjectIds },
                resolved: true,
                notClosedBy: userId,
            },
            populate,
            select,
        });

        return isHome
            ? incidentsUnresolved
            : incidentsUnresolved.concat(incidentsResolved);
    }

    async getSubProjectIncidents(projectId: ObjectID): void {
        const populate: $TSFixMe = [
            {
                path: 'monitors.monitorId',
                select: 'name slug componentId projectId type',
                populate: [
                    { path: 'componentId', select: 'name slug' },
                    { path: 'projectId', select: 'name slug' },
                ],
            },
            { path: 'createdById', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'resolvedBy', select: 'name' },
            { path: 'acknowledgedBy', select: 'name' },
            { path: 'incidentPriority', select: 'name color' },
            {
                path: 'acknowledgedByIncomingHttpRequest',
                select: 'name',
            },
            { path: 'resolvedByIncomingHttpRequest', select: 'name' },
            { path: 'createdByIncomingHttpRequest', select: 'name' },
            { path: 'probes.probeId', select: 'probeName _id probeImage' },
        ];
        const select: $TSFixMe =
            'slug notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

        const monitors: $TSFixMe = await MonitorService.findBy({
            query: { projectId },
            select: '_id',
        });
        const monitorIds: $TSFixMe = monitors.map((monitor: $TSFixMe) => {
            return monitor._id;
        });

        const query: $TSFixMe = {
            'monitors.monitorId': { $in: monitorIds },
        };

        const [incidents, count]: $TSFixMe = await Promise.all([
            this.findBy({
                query,
                limit: 10,
                skip: 0,
                select,
                populate,
            }),
            this.countBy(query),
        ]);

        return [{ incidents, count, _id: projectId, skip: 0, limit: 10 }];
    }

    async getComponentIncidents(
        projectId: ObjectID,
        componentId: $TSFixMe
    ): void {
        const monitors: $TSFixMe = await MonitorService.findBy({
            query: { projectId, componentId },
            select: '_id',
        });
        const monitorIds: $TSFixMe = monitors.map((monitor: $TSFixMe) => {
            return monitor._id;
        });

        const query: $TSFixMe = {
            'monitors.monitorId': { $in: monitorIds },
        };

        const populate: $TSFixMe = [
            {
                path: 'monitors.monitorId',
                select: 'name slug componentId projectId type',
                populate: [
                    { path: 'componentId', select: 'name slug' },
                    { path: 'projectId', select: 'name slug' },
                ],
            },
            { path: 'createdById', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'resolvedBy', select: 'name' },
            { path: 'acknowledgedBy', select: 'name' },
            { path: 'incidentPriority', select: 'name color' },
            {
                path: 'acknowledgedByIncomingHttpRequest',
                select: 'name',
            },
            { path: 'resolvedByIncomingHttpRequest', select: 'name' },
            { path: 'createdByIncomingHttpRequest', select: 'name' },
            { path: 'probes.probeId', select: 'probeName _id probeImage' },
        ];
        const select: $TSFixMe =
            'slug notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

        const [incidents, count]: $TSFixMe = await Promise.all([
            this.findBy({ query, limit: 10, skip: 0, select, populate }),
            this.countBy(query),
        ]);
        const componentIncidents: $TSFixMe = [
            { incidents, _id: projectId, count, skip: 0, limit: 10 },
        ];
        return componentIncidents;
    }

    async getProjectComponentIncidents(
        projectId: ObjectID,
        componentId: $TSFixMe,
        limit: PositiveNumber,
        skip: PositiveNumber
    ): void {
        const monitors: $TSFixMe = await MonitorService.findBy({
            query: { componentId: componentId },
            select: '_id',
        });
        const monitorIds: $TSFixMe = monitors.map((monitor: $TSFixMe) => {
            return monitor._id;
        });

        const query: $TSFixMe = {
            projectId,
            'monitors.monitorId': { $in: monitorIds },
        };

        const populate: $TSFixMe = [
            {
                path: 'monitors.monitorId',
                select: 'name slug componentId projectId type',
                populate: [
                    { path: 'componentId', select: 'name slug' },
                    { path: 'projectId', select: 'name slug' },
                ],
            },
            { path: 'createdById', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'resolvedBy', select: 'name' },
            { path: 'acknowledgedBy', select: 'name' },
            { path: 'incidentPriority', select: 'name color' },
            {
                path: 'acknowledgedByIncomingHttpRequest',
                select: 'name',
            },
            { path: 'resolvedByIncomingHttpRequest', select: 'name' },
            { path: 'createdByIncomingHttpRequest', select: 'name' },
            { path: 'probes.probeId', select: 'probeName _id probeImage' },
        ];
        const select: $TSFixMe =
            'slug notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

        const [incidents, count]: $TSFixMe = await Promise.all([
            this.findBy({ query, limit, skip, select, populate }),
            this.countBy(query),
        ]);
        return { incidents, count, _id: projectId };
    }

    async sendIncidentResolvedNotification(
        incident: $TSFixMe,
        name: $TSFixMe,
        monitor: $TSFixMe
    ): void {
        const populateComponent: $TSFixMe = [
            { path: 'projectId', select: 'name' },
            { path: 'componentCategoryId', select: 'name' },
        ];

        const selectComponent: $TSFixMe =
            '_id createdAt name createdById projectId slug componentCategoryId';
        const component: $TSFixMe = await ComponentService.findOneBy({
            query: {
                _id:
                    monitor.componentId && monitor.componentId._id
                        ? monitor.componentId._id
                        : monitor.componentId,
            },
            select: selectComponent,
            populate: populateComponent,
        });
        const resolvedincident: $TSFixMe = await this.findOneBy({
            query: { _id: incident._id },
            select: 'createdAt resolvedBy',
            populate: [{ path: 'resolvedBy', select: 'name _id' }],
        });
        const downtimestring: $TSFixMe =
            IncidentUtilitiy.calculateHumanReadableDownTime(
                resolvedincident.createdAt
            );

        // send slack notification
        SlackService.sendNotification(
            incident.projectId._id || incident.projectId,
            incident,
            monitor,
            INCIDENT_RESOLVED,
            component,
            downtimestring
        );
        // Ping webhook
        WebHookService.sendIntegrationNotification(
            incident.projectId._id || incident.projectId,
            incident,
            monitor,
            INCIDENT_RESOLVED,
            component,
            downtimestring
        );
        // Ms Teams
        MsTeamsService.sendNotification(
            incident.projectId._id || incident.projectId,
            incident,
            monitor,
            INCIDENT_RESOLVED,
            component,
            downtimestring
        );

        AlertService.sendResolveIncidentMail(incident, monitor);

        const msg: string = `${
            monitor.name
        } monitor was down for ${downtimestring} and is now resolved by ${
            name ||
            (resolvedincident.resolvedBy && resolvedincident.resolvedBy.name) ||
            'oneuptime'
        }`;

        NotificationService.create(
            incident.projectId._id || incident.projectId,
            msg,
            resolvedincident.resolvedBy
                ? resolvedincident.resolvedBy._id
                : 'oneuptime',
            'success'
        );
    }

    async sendIncidentNoteAdded(
        projectId: ObjectID,
        incident: $TSFixMe,
        data: $TSFixMe
    ): void {
        const monitors: $TSFixMe = incident.monitors.map(
            (monitor: $TSFixMe) => {
                return monitor.monitorId;
            }
        );
        for (const monitor of monitors) {
            SlackService.sendIncidentNoteNotification(
                projectId,
                incident,
                data,
                monitor
            );

            MsTeamsService.sendIncidentNoteNotification(
                projectId,
                incident,
                data,
                monitor
            );
        }

        ZapierService.pushToZapier('incident_note', incident, data);
    }

    async restoreBy(query: Query): void {
        query.deleted = true;
        let incident: $TSFixMe = await this.findBy({ query, select: '_id' });
        if (incident && incident.length > 0) {
            const incidents: $TSFixMe = await Promise.all(
                incident.map(async (incident: $TSFixMe) => {
                    const incidentId: $TSFixMe = incident._id;
                    incident = await this.updateOneBy(
                        {
                            _id: incidentId,
                            deleted: true,
                        },
                        {
                            deleted: false,
                            deletedAt: null,
                            deleteBy: null,
                        }
                    );
                    return incident;
                })
            );
            return incidents;
        } else {
            incident = incident[0];
            if (incident) {
                const incidentId: $TSFixMe = incident._id;
                incident = await this.updateOneBy(
                    {
                        _id: incidentId,
                    },
                    {
                        deleted: false,
                        deletedAt: null,
                        deleteBy: null,
                    }
                );
            }
            return incident;
        }
    }

    /**
     * @description removes a particular monitor from incident and deletes the incident
     * @param {string} monitorId the id of the monitor
     * @param {string} userId the id of the user
     */
    async removeMonitor(monitorId: $TSFixMe, userId: ObjectID): void {
        const incidents: $TSFixMe = await this.findBy({
            query: { 'monitors.monitorId': monitorId },
            select: 'monitors _id',
        });

        await Promise.all(
            incidents.map(async (incident: $TSFixMe) => {
                // only delete the incident, since the monitor can be restored
                const monitors: $TSFixMe = incident.monitors
                    .map((monitor: $TSFixMe) => {
                        return {
                            monitorId:
                                monitor.monitorId._id || monitor.monitorId,
                        };
                    })
                    .filter((monitor: $TSFixMe) => {
                        return String(monitor.monitorId) !== String(monitorId);
                    });

                let updatedIncident: $TSFixMe = null;
                if (monitors.length === 0) {
                    // no more monitor in monitors array
                    // delete incident
                    updatedIncident = await IncidentModel.findOneAndUpdate(
                        {
                            _id: incident._id,
                        },
                        {
                            $set: {
                                deleted: true,
                                deletedAt: Date.now(),
                                deletedById: userId,
                                monitors,
                            },
                        },
                        { new: true }
                    );
                } else {
                    updatedIncident = await IncidentModel.findOneAndUpdate(
                        {
                            _id: incident._id,
                        },
                        {
                            $set: {
                                monitors,
                            },
                        },
                        { new: true }
                    );
                }

                const populate: $TSFixMe = [
                    {
                        path: 'monitors.monitorId',
                        select: 'name slug componentId projectId type',
                        populate: [
                            { path: 'componentId', select: 'name slug' },
                            { path: 'projectId', select: 'name slug' },
                        ],
                    },
                    { path: 'createdById', select: 'name' },
                    { path: 'projectId', select: 'name slug' },
                    { path: 'resolvedBy', select: 'name' },
                    { path: 'acknowledgedBy', select: 'name' },
                    { path: 'incidentPriority', select: 'name color' },
                    {
                        path: 'acknowledgedByIncomingHttpRequest',
                        select: 'name',
                    },
                    {
                        path: 'resolvedByIncomingHttpRequest',
                        select: 'name',
                    },
                    {
                        path: 'createdByIncomingHttpRequest',
                        select: 'name',
                    },
                    {
                        path: 'probes.probeId',
                        select: 'probeName _id probeImage',
                    },
                ];
                const select: $TSFixMe =
                    'slug notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

                updatedIncident = await this.findOneBy({
                    query: { _id: updatedIncident._id, deleted: true },
                    select,
                    populate,
                });

                // run in the background
                if (updatedIncident) {
                    RealTimeService.deleteIncident(updatedIncident);
                }
            })
        );
    }

    async startInterval(
        projectId: ObjectID,
        monitors: $TSFixMe,
        incident: $TSFixMe
    ): void {
        monitors = monitors.map((monitor: $TSFixMe) => {
            return monitor.monitorId;
        });
        const [monitorList, currentIncident]: $TSFixMe = await Promise.all([
            MonitorService.findBy({
                query: { _id: { $in: monitors } },
                select: 'incidentCommunicationSla',
                populate: [
                    {
                        path: 'incidentCommunicationSla',
                        select: '_id duration deleted',
                    },
                ],
            }),
            // refetch the incident
            this.findOneBy({
                query: { _id: incident._id },
                select: 'breachedCommunicationSla _id projectId',
            }),
        ]);

        if (!currentIncident.breachedCommunicationSla) {
            const slaList: $TSFixMe = {};
            let fetchedDefault: $TSFixMe = false;

            for (const monitor of monitorList) {
                let sla: $TSFixMe = monitor.incidentCommunicationSla;
                // don't fetch default communication sla twice
                if (!sla && !fetchedDefault) {
                    sla = await IncidentCommunicationSlaService.findOneBy({
                        query: { projectId: projectId, isDefault: true },
                        select: '_id duration deleted',
                    });
                    fetchedDefault = true;
                }

                if (sla && !slaList[sla._id] && !sla.deleted) {
                    slaList[sla._id] = sla;
                }
            }

            // grab the lowest sla and apply to the incident
            let lowestSla: $TSFixMe = {};
            for (const [, value] of Object.entries(slaList)) {
                if (!lowestSla.duration) {
                    lowestSla = value;
                } else {
                    lowestSla =
                        Number(value.duration) < Number(lowestSla.duration)
                            ? value
                            : lowestSla;
                }
            }

            if (!isEmpty(lowestSla)) {
                const incidentCommunicationSla: $TSFixMe = lowestSla;

                if (
                    incidentCommunicationSla &&
                    !incidentCommunicationSla.deleted
                ) {
                    let countDown: $TSFixMe =
                        incidentCommunicationSla.duration * 60;

                    const alertTime: $TSFixMe =
                        incidentCommunicationSla.alertTime * 60;

                    const data: $TSFixMe = {
                        projectId,
                        incidentCommunicationSla,
                        incident: currentIncident,
                        alertTime,
                    };

                    // count down every second
                    const intervalId: $TSFixMe = setInterval(
                        async (): $TSFixMe => {
                            countDown -= 1;

                            // const minutes: $TSFixMe = Math.floor(countDown / 60);
                            // let seconds: $TSFixMe = countDown % 60;
                            // seconds =
                            //     seconds < 10 && seconds !== 0 ? `0${seconds}` : seconds;

                            // await was left out here because we care about the slaCountDown
                            // and also to ensure that it was delivered successfully

                            RealTimeService.sendSlaCountDown(
                                currentIncident,
                                `${countDown}`
                            );

                            if (countDown === alertTime) {
                                // send mail to team
                                AlertService.sendSlaEmailToTeamMembers(data);
                            }

                            if (countDown === 0) {
                                this.clearInterval(currentIncident._id);

                                await this.updateOneBy(
                                    { _id: currentIncident._id },
                                    { breachedCommunicationSla: true }
                                );

                                // send mail to team
                                AlertService.sendSlaEmailToTeamMembers(
                                    data,
                                    true
                                );
                            }
                        },
                        1000
                    );

                    intervals.push({
                        incidentId: currentIncident._id,
                        intervalId,
                    });
                }
            }
        }
    }

    clearInterval(incidentId: $TSFixMe): void {
        intervals = intervals.filter(interval => {
            if (String(interval.incidentId) === String(incidentId)) {
                clearInterval(interval.intervalId);
                return false;
            }
            return true;
        });
    }

    async refreshInterval(incidentId: $TSFixMe): void {
        for (const interval of intervals) {
            if (String(interval.incidentId) === String(incidentId)) {
                this.clearInterval(incidentId);

                const incident: $TSFixMe = await this.findOneBy({
                    query: { _id: incidentId },
                    select: 'monitors projectId _id',
                });
                await this.startInterval(
                    incident.projectId._id || incident.projectId,
                    incident.monitors,
                    incident
                );
                break;
            }
        }
    }
}

/**
 * @description checks if an array contains duplicate values
 * @param {array} myArray the array to be checked
 * @returns {boolean} true or false
 */
function isArrayUnique(myArray: $TSFixMe): void {
    return myArray.length === new Set(myArray).size;
}

let intervals: $TSFixMe = [];
