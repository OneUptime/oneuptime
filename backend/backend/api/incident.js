import express from 'express'
import moment from 'moment'
import Handlebars from 'handlebars'
import IncidentService from '../services/incidentService'
import IncidentTimelineService from '../services/incidentTimelineService'
import MonitorStatusService from '../services/monitorStatusService'
import StatusPageService from '../services/statusPageService'
import RealTimeService from '../services/realTimeService'
import IncidentMessageService from '../services/incidentMessageService'
import AlertService from '../services/alertService'
import UserService from '../services/userService'
import MonitorService from '../services/monitorService'
const router = express.Router();

import { isAuthorized } from '../middlewares/authorization'
import errorService from 'common-server/utils/error'
const isUserAdmin = require('../middlewares/project').isUserAdmin;
const getUser = require('../middlewares/user').getUser;

const getSubProjects = require('../middlewares/subProject').getSubProjects;

const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
import subscriberAlertService from '../services/subscriberAlertService'
import onCallScheduleStatusService from '../services/onCallScheduleStatusService'
import Services from '../utils/services'
import joinNames from '../utils/joinNames'
import { isAuthorizedService } from '../middlewares/serviceAuthorization'
import ErrorService from 'common-server/utils/error'

// data-ingestor will consume this api
// create an incident and return the created incident
router.post(
    '/data-ingestor/create-incident',
    isAuthorizedService,
    async function(req, res) {
        try {
            const data = req.body;

            // Call the IncidentService
            const incident = await IncidentService.create(data);
            return sendItemResponse(req, res, incident);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// data-ingestor will consume this api
// acknowledge an incident
router.post(
    '/data-ingestor/acknowledge-incident',
    isAuthorizedService,
    async function(req, res) {
        try {
            const { incidentId, name, probeId } = req.body;

            const incident = await IncidentService.acknowledge(
                incidentId,
                null,
                name,
                probeId
            );
            return sendItemResponse(req, res, incident);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// data-ingestor will consume this api
// resolve an incident
router.post(
    '/data-ingestor/resolve-incident',
    isAuthorizedService,
    async function(req, res) {
        try {
            const { incidentId, name, probeId } = req.body;

            const incident = await IncidentService.resolve(
                incidentId,
                null,
                name,
                probeId
            );
            return sendItemResponse(req, res, incident);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// data-ingestor will consume this api
// update an incident
router.post(
    '/data-ingestor/update-incident',
    isAuthorizedService,
    async function(req, res) {
        try {
            const { data, query } = req.body;
            const incident = await IncidentService.updateOneBy(query, data);

            return sendItemResponse(req, res, incident);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route
// Description: Creating incident.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.body-> {monitorId, projectId}
// Returns: 200: Incident, 400: Error; 500: Server Error.

router.post(
    '/:projectId/create-incident',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const projectId = req.params.projectId;
            const incidentType = req.body.incidentType;
            const incidentPriority = req.body.incidentPriority;
            const title = req.body.title;
            const description = req.body.description;
            const customFields = req.body.customFields;
            const monitors = req.body.monitors;
            const userId = req.user
                ? req.user.id === 'API'
                    ? null
                    : req.user.id
                : null;
            let createdByApi = false;
            if (req.user && req.user.id === 'API') {
                createdByApi = true;
            }
            let oldIncidentsCount = null;

            // monitors should be an array containing id of monitor(s)
            if (monitors && !Array.isArray(monitors)) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Monitors is not of type array',
                });
            }

            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project ID must be present.',
                });
            }

            if (typeof projectId !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project ID  is not in string type.',
                });
            }

            if (!title) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Title must be present.',
                });
            }

            if (incidentType) {
                if (!['offline', 'online', 'degraded'].includes(incidentType)) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Invalid incident type.',
                    });
                }
                oldIncidentsCount = await IncidentService.countBy({
                    projectId,
                    incidentType,
                    resolved: false,
                    deleted: false,
                    manuallyCreated: true,
                    'monitors.monitorId': { $in: monitors },
                });
            } else {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'IncidentType must be present.',
                });
            }

            if (oldIncidentsCount && oldIncidentsCount > 0) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: `An unresolved incident of type ${incidentType} already exists.`,
                });
            }
            // Call the IncidentService
            const incident = await IncidentService.create({
                projectId,
                createdById: userId,
                manuallyCreated: true,
                incidentType,
                title,
                description,
                incidentPriority,
                customFields,
                monitors,
                createdByApi,
            });
            if (incident) {
                const monitorItems = [];
                for (const monitor of monitors) {
                    monitorItems.push({
                        monitorId: monitor,
                        incidentId: incident._id,
                        manuallyCreated: true,
                        status: incidentType,
                    });
                }
                await MonitorStatusService.createMany(monitorItems);
            }
            return sendItemResponse(req, res, incident);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route
// Description: Getting all the incidents by monitor Id.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.params-> {monitorId}
// Returns: 200: incidents, 400: Error; 500: Server Error.
router.post(
    '/:projectId/monitor/:monitorId',
    getUser,
    isAuthorized,
    async function(req, res) {
        const { monitorId } = req.params;
        // include date range
        try {
            const { startDate, endDate } = req.body;
            let query = {
                'monitors.monitorId': { $in: [monitorId] },
            };

            if (startDate && endDate) {
                const start = moment(startDate).toDate();
                const end = moment(endDate).toDate();
                query = {
                    'monitors.monitorId': { $in: [monitorId] },
                    createdAt: { $gte: start, $lte: end },
                };
            }

            const populate = [
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
                { path: 'probes.probeId', select: 'probeName _id' },
            ];
            const select =
                'slug createdAt reason notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

            const [incidents, count] = await Promise.all([
                IncidentService.findBy({
                    query,
                    limit: req.body.limit || 3,
                    skip: req.body.skip || 0,
                    select,
                    populate,
                }),
                IncidentService.countBy(query),
            ]);
            return sendListResponse(req, res, incidents, count);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Fetch incidents by projectId
router.get('/:projectId', getUser, isAuthorized, getSubProjects, async function(
    req,
    res
) {
    try {
        // const subProjectIds = req.user.subProjects
        //     ? req.user.subProjects.map(project => project._id)
        //     : null;
        const { projectId } = req.params;
        const incidents = await IncidentService.getSubProjectIncidents(
            projectId
        );
        return sendItemResponse(req, res, incidents); // frontend expects sendItemResponse
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

//Fetch incidents by component Id
router.get(
    '/:projectId/:componentId/incidents',
    getUser,
    isAuthorized,
    getSubProjects,
    async function(req, res) {
        try {
            const { componentId, projectId } = req.params;
            const incidents = await IncidentService.getComponentIncidents(
                projectId,
                componentId
            );
            return sendItemResponse(req, res, incidents); // frontend expects sendItemResponse
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route
// Description: Getting incidents that belong to a component and particular project.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.params-> {incidentId}
// Returns: 200: incidents, 400: Error; 500: Server Error.
router.get(
    '/:projectId/incidents/:componentId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { projectId, componentId } = req.params;

            const incident = await IncidentService.getProjectComponentIncidents(
                projectId,
                componentId,
                req.query.limit || 10,
                req.query.skip || 0
            );
            return sendListResponse(req, res, incident); // frontend expects sendListResponse
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get('/:projectId/incident', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const projectId = req.params.projectId;
        const populate = [
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
            { path: 'probes.probeId', select: 'probeName _id' },
        ];
        const select =
            'slug createdAt reason notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

        const monitors = await MonitorService.findBy({
            query: { projectId },
            select: '_id',
        });
        const monitorIds = monitors.map(monitor => monitor._id);

        const query = {
            'monitors.monitorId': { $in: monitorIds },
        };

        const [incident, count] = await Promise.all([
            IncidentService.findBy({
                query,
                limit: req.query.limit || 10,
                skip: req.query.skip || 0,
                select,
                populate,
            }),
            IncidentService.countBy(query),
        ]);
        return sendListResponse(req, res, incident, count); // frontend expects sendListResponse
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Route
// Description: Getting incident.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.params-> {incidentSlug}
// Returns: 200: incidents, 400: Error; 500: Server Error.
router.get(
    '/:projectId/incident/:incidentSlug',
    getUser,
    isAuthorized,
    async function(req, res) {
        // Call the IncidentService.

        try {
            const { incidentSlug } = req.params;
            const populate = [
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
                { path: 'probes.probeId', select: 'probeName _id' },
            ];
            const select =
                'slug createdAt reason response notifications hideIncident acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

            const incident = await IncidentService.findOneBy({
                query: { slug: incidentSlug },
                select,
                populate,
            });
            return sendItemResponse(req, res, incident);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get(
    '/:projectId/timeline/:incidentId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { incidentId } = req.params;

            const populateIncTimeline = [
                { path: 'createdById', select: 'name' },
                {
                    path: 'probeId',
                    select: 'probeName probeImage',
                },
            ];
            const selectIncTimeline =
                'incidentId createdById probeId createdByZapier createdAt status incident_state';
            const [timeline, count] = await Promise.all([
                IncidentTimelineService.findBy({
                    query: { incidentId },
                    skip: req.query.skip || 0,
                    limit: req.query.limit || 10,
                    populate: populateIncTimeline,
                    select: selectIncTimeline,
                }),
                IncidentTimelineService.countBy({ incidentId }),
            ]);
            return sendListResponse(req, res, timeline, count); // frontend expects sendListResponse
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get(
    '/:projectId/unresolvedincidents',
    getUser,
    isAuthorized,
    getSubProjects,
    async function(req, res) {
        try {
            const subProjectIds = req.user.subProjects
                ? req.user.subProjects.map(project => project._id)
                : null;
            // Call the IncidentService.
            const userId = req.user ? req.user.id : null;
            const { isHome } = req.query;
            const incident = await IncidentService.getUnresolvedIncidents(
                subProjectIds,
                userId,
                isHome
            );
            return sendItemResponse(req, res, incident);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post(
    '/:projectId/acknowledge/:incidentId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const userId = req.user
                ? req.user.id === 'API'
                    ? null
                    : req.user.id
                : null;
            let acknowledgedByApi = false;
            if (req.user && req.user.id === 'API') {
                acknowledgedByApi = true;
            }
            const projectId = req.params.projectId;
            const incidentId = req.params.incidentId;

            const incident = await IncidentService.acknowledge(
                incidentId,
                userId,
                req.user.name,
                null,
                null,
                null,
                acknowledgedByApi
            );
            const populateIncidentMessage = [
                {
                    path: 'incidentId',
                    select: 'idNumber name slug',
                },
                { path: 'createdById', select: 'name' },
            ];

            const selectIncidentMessage =
                '_id updated postOnStatusPage createdAt content incidentId createdById type incident_state';

            const populateAlert = [
                { path: 'userId', select: 'name' },
                { path: 'monitorId', select: 'name' },
                { path: 'projectId', select: 'name' },
            ];

            const selectAlert =
                '_id projectId userId alertVia alertStatus eventType monitorId createdAt incidentId onCallScheduleStatus schedule escalation error errorMessage alertProgress deleted deletedAt deletedById';

            const populate = [
                { path: 'incidentId', select: 'name' },
                { path: 'projectId', select: 'name' },
                {
                    path: 'subscriberId',
                    select:
                        'name contactEmail contactPhone contactWebhook countryCode',
                },
            ];
            const select =
                'incidentId projectId subscriberId alertVia alertStatus eventType error errorMessage totalSubscribers identification';
            const selectOnCallScheduleStatus =
                'escalations createdAt project schedule activeEscalation activeEscalation incident incidentAcknowledged alertedEveryone isOnDuty deleted deletedAt deletedById';

            const populateOnCallScheduleStatus = [
                { path: 'incidentId', select: 'name slug' },
                { path: 'project', select: 'name slug' },
                { path: 'scheduleId', select: 'name slug' },
                { path: 'schedule', select: '_id name slug' },
                {
                    path: 'activeEscalationId',
                    select: 'projectId teams scheduleId',
                },
            ];

            const populateIncTimeline = [
                { path: 'createdById', select: 'name' },
                {
                    path: 'probeId',
                    select: 'probeName probeImage',
                },
            ];
            const selectIncTimeline =
                'incidentId createdById probeId createdByZapier createdAt status incident_state';
            /* eslint-disable prefer-const */
            let [
                incidentMessages,
                timeline,
                alerts,
                subscriberAlerts,
                callScheduleStatus,
            ] = await Promise.all([
                IncidentMessageService.findBy({
                    query: {
                        incidentId,
                        type: 'internal',
                    },
                    populate: populateIncidentMessage,
                    select: selectIncidentMessage,
                }),
                IncidentTimelineService.findBy({
                    query: { incidentId },
                    select: selectIncTimeline,
                    populate: populateIncTimeline,
                }),
                AlertService.findBy({
                    query: { incidentId },
                    populate: populateAlert,
                    select: selectAlert,
                }),
                subscriberAlertService.findBy({
                    query: { incidentId, projectId },
                    select,
                    populate,
                }),
                onCallScheduleStatusService.findBy({
                    query: { incidentId },
                    select: selectOnCallScheduleStatus,
                    populate: populateOnCallScheduleStatus,
                }),
            ]);
            /* eslint-enable prefer-const */

            const [subAlerts, scheduleStatus] = await Promise.all([
                Services.deduplicate(subscriberAlerts),
                Services.checkCallSchedule(callScheduleStatus),
            ]);
            callScheduleStatus = scheduleStatus;

            const timelineAlerts = [
                ...timeline,
                ...alerts,
                ...incidentMessages,
            ].sort((a, b) => {
                return b.createdAt - a.createdAt;
            });
            incidentMessages = [
                ...timelineAlerts,
                ...subAlerts,
                ...callScheduleStatus,
            ];
            incidentMessages.sort(
                (a, b) =>
                    typeof a.schedule !== 'object' && b.createdAt - a.createdAt
            );
            const filteredMsg = incidentMessages.filter(
                a =>
                    a.status !== 'internal notes added' &&
                    a.status !== 'internal notes updated'
            );
            const result = {
                data: await Services.rearrangeDuty(filteredMsg),
                incident,
                type: 'internal',
            };
            return sendItemResponse(req, res, result);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route
// Description: Updating user who resolved incident.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.body-> {incidentId, projectId}
// Returns: 200: incident, 400: Error; 500: Server Error.
router.post(
    '/:projectId/resolve/:incidentId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const userId = req.user
                ? req.user.id === 'API'
                    ? null
                    : req.user.id
                : null;
            let resolvedByApi = false;
            if (req.user && req.user.id === 'API') {
                resolvedByApi = true;
            }
            const projectId = req.params.projectId;
            const incidentId = req.params.incidentId;

            const incident = await IncidentService.resolve(
                incidentId,
                userId,
                null,
                null,
                null,
                null,
                resolvedByApi
            );
            const populateIncidentMessage = [
                {
                    path: 'incidentId',
                    select: 'idNumber name slug',
                },
                { path: 'createdById', select: 'name' },
            ];

            const selectIncidentMessage =
                '_id updated postOnStatusPage createdAt content incidentId createdById type incident_state';

            const populateAlert = [
                { path: 'userId', select: 'name' },
                { path: 'monitorId', select: 'name' },
                { path: 'projectId', select: 'name' },
            ];

            const selectAlert =
                '_id projectId userId alertVia alertStatus eventType monitorId createdAt incidentId onCallScheduleStatus schedule escalation error errorMessage alertProgress deleted deletedAt deletedById';

            const populate = [
                { path: 'incidentId', select: 'name' },
                { path: 'projectId', select: 'name' },
                {
                    path: 'subscriberId',
                    select:
                        'name contactEmail contactPhone contactWebhook countryCode',
                },
            ];
            const select =
                'incidentId projectId subscriberId alertVia alertStatus eventType error errorMessage totalSubscribers identification';

            const selectOnCallScheduleStatus =
                'escalations createdAt project schedule activeEscalation activeEscalation incident incidentAcknowledged alertedEveryone isOnDuty deleted deletedAt deletedById';

            const populateOnCallScheduleStatus = [
                { path: 'incidentId', select: 'name slug' },
                { path: 'project', select: 'name slug' },
                { path: 'scheduleId', select: 'name slug' },
                { path: 'schedule', select: '_id name slug' },
                {
                    path: 'activeEscalationId',
                    select: 'projectId teams scheduleId',
                },
            ];
            const populateIncTimeline = [
                { path: 'createdById', select: 'name' },
                {
                    path: 'probeId',
                    select: 'probeName probeImage',
                },
            ];
            const selectIncTimeline =
                'incidentId createdById probeId createdByZapier createdAt status incident_state';
            /* eslint-disable prefer-const */
            let [
                incidentMessages,
                timeline,
                alerts,
                subscriberAlerts,
                callScheduleStatus,
            ] = await Promise.all([
                IncidentMessageService.findBy({
                    query: {
                        incidentId,
                        type: 'internal',
                    },
                    populate: populateIncidentMessage,
                    select: selectIncidentMessage,
                }),
                IncidentTimelineService.findBy({
                    query: { incidentId },
                    select: selectIncTimeline,
                    populate: populateIncTimeline,
                }),
                AlertService.findBy({
                    query: { incidentId },
                    select: selectAlert,
                    populate: populateAlert,
                }),
                subscriberAlertService.findBy({
                    query: { incidentId, projectId },
                    select,
                    populate,
                }),
                onCallScheduleStatusService.findBy({
                    query: { incidentId },
                    select: selectOnCallScheduleStatus,
                    populate: populateOnCallScheduleStatus,
                }),
            ]);
            /* eslint-enable prefer-const */

            const [subAlerts, scheduleStatus] = await Promise.all([
                Services.deduplicate(subscriberAlerts),
                Services.checkCallSchedule(callScheduleStatus),
            ]);

            callScheduleStatus = scheduleStatus;

            const timelineAlerts = [
                ...timeline,
                ...alerts,
                ...incidentMessages,
            ].sort((a, b) => {
                return b.createdAt - a.createdAt;
            });
            incidentMessages = [
                ...timelineAlerts,
                ...subAlerts,
                ...callScheduleStatus,
            ];
            incidentMessages.sort(
                (a, b) =>
                    typeof a.schedule !== 'object' && b.createdAt - a.createdAt
            );
            const filteredMsg = incidentMessages.filter(
                a =>
                    a.status !== 'internal notes added' &&
                    a.status !== 'internal notes updated'
            );
            const result = {
                data: await Services.rearrangeDuty(filteredMsg),
                incident,
                type: 'internal',
            };

            return sendItemResponse(req, res, result);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post(
    '/:projectId/close/:incidentId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const userId = req.user ? req.user.id : null;
            const { incidentId } = req.params;
            // Call the IncidentService
            const incident = await IncidentService.close(incidentId, userId);
            return sendItemResponse(req, res, incident);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// update incident details
// title, description, priority and type
router.put(
    '/:projectId/incident/:incidentId/details',
    getUser,
    isAuthorized,
    async function(req, res) {
        const projectId = req.params.projectId;
        const incidentId = req.params.incidentId;
        const { title, description, incidentPriority } = req.body;

        const query = {
            title,
            description,
            incidentPriority,
        };

        if (!incidentId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'incidentId must be set.',
            });
        }
        try {
            const incident = await IncidentService.updateOneBy(
                {
                    projectId,
                    _id: incidentId,
                },
                query
            );
            return sendItemResponse(req, res, incident);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);
router.post(
    '/:projectId/incident/:incidentId/message',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const data = req.body;
            const incidentId = req.params.incidentId;
            const projectId = req.params.projectId;
            const populate = [
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
                { path: 'probes.probeId', select: 'probeName _id' },
            ];
            const select =
                'slug createdAt reason notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

            const populateIncidentMessage = [
                {
                    path: 'incidentId',
                    select: 'idNumber name slug',
                },
                { path: 'createdById', select: 'name' },
            ];

            const selectIncidentMessage =
                '_id updated postOnStatusPage createdAt content incidentId createdById type incident_state';

            const incident = await IncidentService.findOneBy({
                query: { _id: incidentId },
                select,
                populate,
            });
            const idNumber = incident.idNumber;

            const userId = req.user.id;
            if (!data.content) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Incident Message is required.',
                });
            }
            if (typeof data.content !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Incident Message is not in string type.',
                });
            }

            if (!data.incident_state) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Incident State is required.',
                });
            }
            if (typeof data.incident_state !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Incident State is not in string type.',
                });
            }

            if (!data.id) {
                // this is a message creation Rquest
                if (!data.type) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Incident Message type is required.',
                    });
                }
                if (typeof data.type !== 'string') {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Incident Message type is not in string type.',
                    });
                }

                if (!['investigation', 'internal'].includes(data.type)) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message:
                            'Incident Message type is not of required types.',
                    });
                }
            }

            if (!incident) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Incident not found.',
                });
            }

            // If the message ID is available, treat this as an update
            if (data.id) {
                // validate if Message ID exist or not
                const incidentMsgCount = await IncidentMessageService.countBy({
                    _id: data.id,
                });

                if (!incidentMsgCount || incidentMsgCount === 0) {
                    return sendErrorResponse(req, res, {
                        code: 404,
                        message: 'Incident Message not found.',
                    });
                }
            }
            let incidentMessage = null;
            if (incident && incident._id) {
                data.incidentId = incidentId;

                const monitors = incident.monitors.map(
                    monitor => monitor.monitorId.name
                );
                const templateInput = {
                    time: moment(incident.createdAt).format('h:mm:ss a'),
                    date: moment(incident.createdAt).format('MMM Do YYYY'),
                    projectName: incident.projectId.name,
                    incidentType: incident.incidentType,
                    monitorName: joinNames(monitors),
                };
                const incidentStateTemplate = Handlebars.compile(
                    data.incident_state
                );
                const contentTemplate = Handlebars.compile(data.content);

                data.incident_state = incidentStateTemplate(templateInput);
                data.content = contentTemplate(templateInput);

                // handle creation or updating
                if (!data.id) {
                    data.createdById = req.user.id;
                    data.monitors = incident.monitors.map(
                        monitor => monitor.monitorId
                    );
                    incidentMessage = await IncidentMessageService.create(data);
                    if (data.post_statuspage) {
                        AlertService.sendInvestigationNoteToSubscribers(
                            incident,
                            data,
                            'created',
                            projectId
                        ).catch(error => {
                            errorService.log(
                                'AlertService.sendInvestigationNoteToSubscribers',
                                error
                            );
                        });
                    }
                } else {
                    const updatedMessage = {
                        content: data.content,
                        incident_state: data.incident_state,
                    };

                    const [message, investigation] = await Promise.all([
                        IncidentMessageService.updateOneBy(
                            { _id: data.id },
                            updatedMessage
                        ),
                        IncidentMessageService.findOneBy({
                            query: { _id: data.id },
                            select: selectIncidentMessage,
                            populate: populateIncidentMessage,
                        }),
                    ]);
                    incidentMessage = message;

                    if (investigation.type === 'investigation') {
                        AlertService.sendInvestigationNoteToSubscribers(
                            incident,
                            data,
                            'updated',
                            projectId
                        ).catch(error => {
                            errorService.log(
                                'AlertService.sendInvestigationNoteToSubscribers',
                                error
                            );
                        });
                    }
                }
                // send project webhook notification
                AlertService.sendStausPageNoteNotificationToProjectWebhooks(
                    projectId,
                    incident,
                    {
                        ...data,
                        statusNoteStatus: data.id ? 'updated' : 'created',
                    }
                ).catch(error => {
                    errorService.log(
                        'IncidentAPI.sendInvestigationToProjectWebhooks',
                        error
                    );
                });
                const status = `${incidentMessage.type} notes ${
                    data.id ? 'updated' : 'added'
                }`;

                const user = await UserService.findOneBy({
                    query: { _id: userId },
                    select: 'name',
                });

                data.created_by =
                    user && user.name ? user.name : 'OneUptime User';

                const populateAlert = [
                    { path: 'userId', select: 'name' },
                    { path: 'monitorId', select: 'name' },
                    { path: 'projectId', select: 'name' },
                ];

                const selectAlert =
                    '_id projectId userId alertVia alertStatus eventType monitorId createdAt incidentId onCallScheduleStatus schedule escalation error errorMessage alertProgress deleted deletedAt deletedById';

                const populate = [
                    { path: 'incidentId', select: 'name' },
                    { path: 'projectId', select: 'name' },
                    {
                        path: 'subscriberId',
                        select:
                            'name contactEmail contactPhone contactWebhook countryCode',
                    },
                ];
                const select =
                    'incidentId projectId subscriberId alertVia alertStatus eventType error errorMessage totalSubscribers identification';
                const selectOnCallScheduleStatus =
                    'escalations createdAt project schedule activeEscalation activeEscalation incident incidentAcknowledged alertedEveryone isOnDuty deleted deletedAt deletedById';

                const populateOnCallScheduleStatus = [
                    { path: 'incidentId', select: 'name slug' },
                    { path: 'project', select: 'name slug' },
                    { path: 'scheduleId', select: 'name slug' },
                    { path: 'schedule', select: '_id name slug' },
                    {
                        path: 'activeEscalationId',
                        select: 'projectId teams scheduleId',
                    },
                ];

                const populateIncTimeline = [
                    { path: 'createdById', select: 'name' },
                    {
                        path: 'probeId',
                        select: 'probeName probeImage',
                    },
                ];
                const selectIncTimeline =
                    'incidentId createdById probeId createdByZapier createdAt status incident_state';
                const [alerts, subscriberAlerts] = await Promise.all([
                    AlertService.findBy({
                        query: { incidentId: incident._id },
                        select: selectAlert,
                        populate: populateAlert,
                    }),
                    subscriberAlertService.findBy({
                        query: {
                            incidentId: incident._id,
                            projectId,
                        },
                        select,
                        populate,
                    }),
                    IncidentTimelineService.create({
                        incidentId: incident._id,
                        createdById: req.user.id,
                        incident_state: data.incident_state,
                        status,
                    }),
                    IncidentService.sendIncidentNoteAdded(
                        projectId,
                        incident,
                        data
                    ),
                ]);

                if (
                    data.type === 'internal' ||
                    (data.type === 'internal' &&
                        data.incident_state === 'update')
                ) {
                    /* eslint-disable prefer-const */
                    let [
                        incidentMessages,
                        timeline,
                        subAlerts,
                        callScheduleStatus,
                    ] = await Promise.all([
                        IncidentMessageService.findBy({
                            query: {
                                incidentId: incident._id,
                                type: data.type,
                            },
                            select: selectIncidentMessage,
                            populate: populateIncidentMessage,
                        }),
                        IncidentTimelineService.findBy({
                            query: { incidentId: incident._id },
                            select: selectIncTimeline,
                            populate: populateIncTimeline,
                        }),
                        Services.deduplicate(subscriberAlerts),
                        onCallScheduleStatusService.findBy({
                            query: { incident: incident._id },
                            select: selectOnCallScheduleStatus,
                            populate: populateOnCallScheduleStatus,
                        }),
                    ]);
                    /* eslint-enable*/

                    callScheduleStatus = await Services.checkCallSchedule(
                        callScheduleStatus
                    );
                    const timelineAlerts = [
                        ...timeline,
                        ...alerts,
                        ...incidentMessages,
                    ].sort((a, b) => {
                        return b.createdAt - a.createdAt;
                    });
                    incidentMessages = [
                        ...timelineAlerts,
                        ...subAlerts,
                        ...callScheduleStatus,
                    ];
                    incidentMessages.sort(
                        (a, b) =>
                            typeof a.schedule !== 'object' &&
                            b.createdAt - a.createdAt
                    );
                    const filteredMsg = incidentMessages.filter(
                        a =>
                            a.status !== 'internal notes added' &&
                            a.status !== 'internal notes updated'
                    );
                    incidentMessage = {
                        type: data.type,
                        idNumber,
                        data: await Services.rearrangeDuty(filteredMsg),
                        incidentSlug: incident.slug,
                    };
                } else {
                    incidentMessage = await IncidentMessageService.findOneBy({
                        query: {
                            _id: incidentMessage._id,
                            incidentId: incidentMessage.incidentId,
                        },
                        select: selectIncidentMessage,
                        populate: populateIncidentMessage,
                    });
                }
            }
            return sendItemResponse(req, res, incidentMessage);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// fetches status pages for an incident
// returns a list of status pages pointing to the incident
router.get(
    '/:projectId/:incidentSlug/statuspages',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { incidentSlug } = req.params;

            const incident = await IncidentService.findOneBy({
                query: { slug: incidentSlug },
                select: '_id',
            });
            if (incident) {
                const {
                    statusPages,
                    count,
                } = await StatusPageService.getStatusPagesForIncident(
                    incident._id,
                    parseInt(req.query.skip) || 0,
                    parseInt(req.query.limit) || 10
                );
                return sendListResponse(req, res, statusPages, count);
            } else {
                return sendListResponse(req, res, [], 0);
            }
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.delete(
    '/:projectId/incident/:incidentId/message/:incidentMessageId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { incidentId, incidentMessageId, projectId } = req.params;
            const populateIncidentMessage = [
                { path: 'incidentId', select: 'idNumber name slug' },
                { path: 'createdById', select: 'name' },
            ];

            const selectIncidentMessage =
                '_id updated postOnStatusPage createdAt content incidentId createdById type incident_state';

            const [incident, checkMsg, incidentMessage] = await Promise.all([
                IncidentService.findOneBy({
                    query: { _id: incidentId },
                    select: 'idNumber slug',
                }),
                IncidentMessageService.findOneBy({
                    query: { _id: incidentMessageId },
                    select: selectIncidentMessage,
                    populate: populateIncidentMessage,
                }),
                IncidentMessageService.deleteBy(
                    {
                        _id: incidentMessageId,
                        incidentId,
                    },
                    req.user.id
                ),
            ]);
            const idNumber = incident.idNumber;
            let result;
            /* eslint-disable prefer-const */
            if (incidentMessage) {
                const status = `${incidentMessage.type} notes deleted`;

                try {
                    // RUN IN THE BACKGROUND
                    RealTimeService.deleteIncidentNote(incidentMessage);
                } catch (error) {
                    ErrorService.log(
                        'realtimeService.deleteIncidentNote',
                        error
                    );
                }

                const populateAlert = [
                    { path: 'userId', select: 'name' },
                    { path: 'monitorId', select: 'name' },
                    { path: 'projectId', select: 'name' },
                ];

                const selectAlert =
                    '_id projectId userId alertVia alertStatus eventType monitorId createdAt incidentId onCallScheduleStatus schedule escalation error errorMessage alertProgress deleted deletedAt deletedById';

                const populate = [
                    { path: 'incidentId', select: 'name' },
                    { path: 'projectId', select: 'name' },
                    {
                        path: 'subscriberId',
                        select:
                            'name contactEmail contactPhone contactWebhook countryCode',
                    },
                ];
                const select =
                    'incidentId projectId subscriberId alertVia alertStatus eventType error errorMessage totalSubscribers identification';

                const selectOnCallScheduleStatus =
                    'escalations createdAt project schedule activeEscalation activeEscalation incident incidentAcknowledged alertedEveryone isOnDuty deleted deletedAt deletedById';

                const populateOnCallScheduleStatus = [
                    { path: 'incidentId', select: 'name slug' },
                    { path: 'project', select: 'name slug' },
                    { path: 'scheduleId', select: 'name slug' },
                    {
                        path: 'schedule',
                        select: '_id name slug',
                    },
                    {
                        path: 'activeEscalationId',
                        select: 'projectId teams scheduleId',
                    },
                ];

                const populateIncTimeline = [
                    { path: 'createdById', select: 'name' },
                    {
                        path: 'probeId',
                        select: 'probeName probeImage',
                    },
                ];
                const selectIncTimeline =
                    'incidentId createdById probeId createdByZapier createdAt status incident_state';
                let [
                    alerts,
                    subscriberAlerts,
                    callScheduleStatus,
                ] = await Promise.all([
                    AlertService.findBy({
                        query: { incidentId: incidentId },
                        select: selectAlert,
                        populate: populateAlert,
                    }),
                    subscriberAlertService.findBy({
                        query: { incidentId: incidentId, projectId },
                        select,
                        populate,
                    }),
                    onCallScheduleStatusService.findBy({
                        query: { incident: incidentId },
                        select: selectOnCallScheduleStatus,
                        populate: populateOnCallScheduleStatus,
                    }),
                    IncidentTimelineService.create({
                        incidentId,
                        createdById: req.user.id,
                        status,
                    }),
                ]);

                callScheduleStatus = await Services.checkCallSchedule(
                    callScheduleStatus
                );
                if (checkMsg.type === 'investigation') {
                    result = incidentMessage;
                } else {
                    let [
                        incidentMessages,
                        timeline,
                        subAlerts,
                    ] = await Promise.all([
                        IncidentMessageService.findBy({
                            query: { incidentId, type: checkMsg.type },
                            populate: populateIncidentMessage,
                            select: selectIncidentMessage,
                        }),
                        IncidentTimelineService.findBy({
                            query: { incidentId },
                            select: selectIncTimeline,
                            populate: populateIncTimeline,
                        }),
                        Services.deduplicate(subscriberAlerts),
                    ]);
                    const timelineAlerts = [
                        ...timeline,
                        ...alerts,
                        ...incidentMessages,
                    ].sort((a, b) => {
                        return b.createdAt - a.createdAt;
                    });
                    incidentMessages = [
                        ...timelineAlerts,
                        ...subAlerts,
                        ...callScheduleStatus,
                    ];
                    incidentMessages.sort(
                        (a, b) =>
                            typeof a.schedule !== 'object' &&
                            b.createdAt - a.createdAt
                    );
                    const filteredMsg = incidentMessages.filter(
                        a =>
                            a.status !== 'internal notes added' &&
                            a.status !== 'internal notes updated'
                    );
                    result = {
                        type: checkMsg.type,
                        idNumber,
                        data: await Services.rearrangeDuty(filteredMsg),
                        incidentSlug: incident.slug,
                    };
                }
                /* eslint-enable prefer-const */
                return sendItemResponse(req, res, result);
            } else {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Incident Message not found',
                });
            }
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);
router.get(
    '/:projectId/incident/:incidentSlug/message',
    getUser,
    isAuthorized,
    async function(req, res) {
        let type = 'investigation';
        if (req.query.type && req.query.type === 'internal') {
            type = 'internal';
        }
        try {
            let incidentMessages,
                result = [],
                count = 0;
            const incidentSlug = req.params.incidentSlug;
            const projectId = req.params.projectId;
            let incidentId = await IncidentService.findOneBy({
                query: { slug: incidentSlug },
                select: '_id',
            });
            if (incidentId) {
                incidentId = incidentId._id;
                let skip = 0,
                    limit = 0;
                if (type === 'investigation') {
                    skip = req.query.skip || 0;
                    limit = req.query.limit || 10;
                }

                const populateIncidentMessage = [
                    {
                        path: 'incidentId',
                        select: 'idNumber name slug',
                    },
                    { path: 'createdById', select: 'name' },
                ];

                const selectIncidentMessage =
                    '_id updated postOnStatusPage createdAt content incidentId createdById type incident_state';
                const populateAlert = [
                    { path: 'userId', select: 'name' },
                    { path: 'monitorId', select: 'name' },
                    { path: 'projectId', select: 'name' },
                ];

                const selectAlert =
                    '_id projectId userId alertVia alertStatus eventType monitorId createdAt incidentId onCallScheduleStatus schedule escalation error errorMessage alertProgress deleted deletedAt deletedById';

                const populate = [
                    { path: 'incidentId', select: 'name' },
                    { path: 'projectId', select: 'name' },
                    {
                        path: 'subscriberId',
                        select:
                            'name contactEmail contactPhone contactWebhook countryCode',
                    },
                ];
                const select =
                    'incidentId projectId subscriberId alertVia alertStatus eventType error errorMessage totalSubscribers identification';

                const selectOnCallScheduleStatus =
                    'escalations createdAt project schedule activeEscalation activeEscalation incident incidentAcknowledged alertedEveryone isOnDuty deleted deletedAt deletedById';

                const populateOnCallScheduleStatus = [
                    { path: 'incidentId', select: 'name slug' },
                    { path: 'project', select: 'name slug' },
                    { path: 'scheduleId', select: 'name slug' },
                    {
                        path: 'schedule',
                        select: '_id name slug',
                    },
                    {
                        path: 'activeEscalationId',
                        select: 'projectId teams scheduleId',
                    },
                ];

                const populateIncTimeline = [
                    { path: 'createdById', select: 'name' },
                    {
                        path: 'probeId',
                        select: 'probeName probeImage',
                    },
                ];
                const selectIncTimeline =
                    'incidentId createdById probeId createdByZapier createdAt status incident_state';
                const [
                    timeline,
                    alerts,
                    subscriberAlerts,
                    messageCount,
                    incMessages,
                ] = await Promise.all([
                    IncidentTimelineService.findBy({
                        query: { incidentId },
                        select: selectIncTimeline,
                        populate: populateIncTimeline,
                    }),
                    AlertService.findBy({
                        query: { incidentId: incidentId },
                        select: selectAlert,
                        populate: populateAlert,
                    }),
                    subscriberAlertService.findBy({
                        query: { incidentId: incidentId, projectId },
                        select,
                        populate,
                    }),
                    IncidentMessageService.countBy({
                        incidentId,
                        type,
                    }),
                    IncidentMessageService.findBy({
                        query: {
                            incidentId,
                            type,
                        },
                        skip,
                        limit,
                        populate: populateIncidentMessage,
                        select: selectIncidentMessage,
                    }),
                ]);
                incidentMessages = incMessages;
                count = messageCount;
                if (type === 'investigation') {
                    result = incidentMessages;
                } else {
                    const [subAlerts, scheduleStatus] = await Promise.all([
                        Services.deduplicate(subscriberAlerts),
                        onCallScheduleStatusService.findBy({
                            query: { incident: incidentId },
                            select: selectOnCallScheduleStatus,
                            populate: populateOnCallScheduleStatus,
                        }),
                    ]);
                    const callScheduleStatus = await Services.checkCallSchedule(
                        scheduleStatus
                    );
                    const timelineAlerts = [
                        ...timeline,
                        ...alerts,
                        ...incidentMessages,
                    ].sort((a, b) => {
                        return b.createdAt - a.createdAt;
                    });
                    incidentMessages = [
                        ...timelineAlerts,
                        ...subAlerts,
                        ...callScheduleStatus,
                    ];
                    incidentMessages.sort(
                        (a, b) =>
                            typeof a.schedule !== 'object' &&
                            b.createdAt - a.createdAt
                    );
                    const filteredMsg = incidentMessages.filter(
                        a =>
                            a.status !== 'internal notes added' &&
                            a.status !== 'internal notes updated'
                    );

                    result = await Services.rearrangeDuty(filteredMsg);
                }
            }
            return sendListResponse(req, res, result, count);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.delete('/:projectId/:incidentId', getUser, isUserAdmin, async function(
    req,
    res
) {
    try {
        const { projectId, incidentId } = req.params;
        const incident = await IncidentService.deleteBy(
            { _id: incidentId, projectId },
            req.user.id
        );
        if (incident) {
            try {
                // RUN IN THE BACKGROUND
                RealTimeService.deleteIncident(incident);
            } catch (error) {
                ErrorService.log('realtimeService.deleteIncident', error);
            }
            return sendItemResponse(req, res, incident);
        } else {
            return sendErrorResponse(req, res, {
                message: 'Incident not found',
            });
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:incidentId', getUser, async function(req, res) {
    try {
        const { projectId, incidentId } = req.params;
        const { hideIncident } = req.body;
        const result = await IncidentService.updateOneBy(
            {
                projectId,
                _id: incidentId,
            },
            { hideIncident }
        );
        const incident = {
            hideIncident: result.hideIncident,
        };
        return sendItemResponse(req, res, incident);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Route
// IMPORTANT: THIS API IS USED IN AN EMAIL.
// Description: Updating user who resolved incident.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.body-> {incidentId, projectId}
// Returns: 200: incident, 400: Error; 500: Server Error.
router.get(
    '/:projectId/resolve/:incidentId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const userId = req.user ? req.user.id : null;

            // get incident properties to build url
            const { incidentId, projectId } = req.params;

            const [incident] = await Promise.all([
                IncidentService.findOneBy({
                    query: { projectId, _id: incidentId },
                    select: 'idNumber projectId slug',
                    populate: [{ path: 'projectId', select: 'slug' }],
                }),
                IncidentService.resolve(incidentId, userId),
            ]);

            const { projectId: project } = incident;

            return res.status(200).render('incidentAction.ejs', {
                title: 'Incident Resolved',
                title_message: 'Incident Resolved',
                body_message: 'Your incident is now resolved.',
                action: 'resolve',
                dashboard_url: `${global.dashboardHost}/project/${project.slug}/incidents/${incident.slug}`,
                apiUrl: global.apiHost,
            });
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route
// IMPORTANT: THIS API IS USED IN AN ALERT EMAIL.
// Description: Updating user who resolved incident.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.body-> {incidentId, projectId}
// Returns: 200: incident, 400: Error; 500: Server Error.
router.get(
    '/:projectId/acknowledge/:incidentId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const userId = req.user ? req.user.id : null;

            // get incident properties to build url
            const { incidentId, projectId } = req.params;

            const [incident] = await Promise.all([
                IncidentService.findOneBy({
                    query: { projectId, _id: incidentId },
                    select: 'idNumber projectId slug',
                    populate: [{ path: 'projectId', select: 'slug' }],
                }),
                IncidentService.acknowledge(incidentId, userId, req.user.name),
            ]);

            const { projectId: project } = incident;

            return res.status(200).render('incidentAction.ejs', {
                title: 'Incident Acknowledged',
                title_message: 'Incident Acknowledged',
                body_message: 'Your incident is now acknowledged.',
                action: 'acknowledge',
                dashboard_url: `${global.dashboardHost}/project/${project.slug}/incidents/${incident.slug}`,
                apiUrl: global.apiHost,
            });
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

export default router;
