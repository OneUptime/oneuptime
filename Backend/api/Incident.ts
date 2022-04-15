import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import moment from 'moment';
import Handlebars from 'handlebars';
import BadDataException from 'Common/Types/Exception/BadDataException';
import IncidentService from '../services/incidentService';
import IncidentTimelineService from '../services/incidentTimelineService';
import MonitorStatusService from '../services/monitorStatusService';
import StatusPageService from '../services/statusPageService';
import RealTimeService from '../services/realTimeService';
import IncidentMessageService from '../services/incidentMessageService';
import AlertService from '../services/alertService';
import UserService from '../services/userService';
import MonitorService from '../services/monitorService';
const router: $TSFixMe = express.getRouter();

import { isAuthorized } from '../middlewares/authorization';
import errorService from 'CommonServer/Utils/error';
const isUserAdmin: $TSFixMe = require('../middlewares/project').isUserAdmin;
const getUser: $TSFixMe = require('../middlewares/user').getUser;

const getSubProjects: $TSFixMe =
    require('../middlewares/subProject').getSubProjects;

import {
    sendErrorResponse,
    sendListResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';
import subscriberAlertService from '../services/subscriberAlertService';
import onCallScheduleStatusService from '../services/onCallScheduleStatusService';
import Services from '../Utils/services';
import joinNames from '../Utils/joinNames';
import ClusterKeyAuthorization from 'CommonServer/middleware/ClusterKeyAuthorization';
import ErrorService from 'CommonServer/Utils/error';

// data-ingestor will consume this api
// create an incident and return the created incident
router.post(
    '/data-ingestor/create-incident',
    ClusterKeyAuthorization.isAuthorizedService,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = req.body;

            // Call the IncidentService
            const incident: $TSFixMe = await IncidentService.create(data);
            return sendItemResponse(req, res, incident);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// data-ingestor will consume this api
// acknowledge an incident
router.post(
    '/data-ingestor/acknowledge-incident',
    ClusterKeyAuthorization.isAuthorizedService,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { incidentId, name, probeId }: $TSFixMe = req.body;

            const incident: $TSFixMe = await IncidentService.acknowledge(
                incidentId,
                null,
                name,
                probeId
            );
            return sendItemResponse(req, res, incident);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// data-ingestor will consume this api
// resolve an incident
router.post(
    '/data-ingestor/resolve-incident',
    ClusterKeyAuthorization.isAuthorizedService,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { incidentId, name, probeId }: $TSFixMe = req.body;

            const incident: $TSFixMe = await IncidentService.resolve(
                incidentId,
                null,
                name,
                probeId
            );
            return sendItemResponse(req, res, incident);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// data-ingestor will consume this api
// update an incident
router.post(
    '/data-ingestor/update-incident',
    ClusterKeyAuthorization.isAuthorizedService,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { data, query }: $TSFixMe = req.body;
            const incident: $TSFixMe = await IncidentService.updateOneBy(
                query,
                data
            );

            return sendItemResponse(req, res, incident);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
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
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId: $TSFixMe = req.params.projectId;
            const incidentType: $TSFixMe = req.body.incidentType;
            const incidentPriority: $TSFixMe = req.body.incidentPriority;
            const title: $TSFixMe = req.body.title;
            const description: $TSFixMe = req.body.description;
            const customFields: $TSFixMe = req.body.customFields;
            const monitors: $TSFixMe = req.body.monitors;

            const userId: $TSFixMe = req.user
                ? req.user.id === 'API'
                    ? null
                    : req.user.id
                : null;
            let createdByApi: $TSFixMe = false;

            if (req.user && req.user.id === 'API') {
                createdByApi = true;
            }
            let oldIncidentsCount: $TSFixMe = null;

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
            const incident: $TSFixMe = await IncidentService.create({
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
                const monitorItems: $TSFixMe = [];
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
            return sendErrorResponse(req, res, error as Exception);
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
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { monitorId }: $TSFixMe = req.params;
        // include date range
        try {
            const { startDate, endDate }: $TSFixMe = req.body;
            let query: $TSFixMe = {
                'monitors.monitorId': { $in: [monitorId] },
            };

            if (startDate && endDate) {
                const start: $TSFixMe = moment(startDate).toDate();
                const end: $TSFixMe = moment(endDate).toDate();
                query = {
                    'monitors.monitorId': { $in: [monitorId] },

                    createdAt: { $gte: start, $lte: end },
                };
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
                { path: 'resolvedByIncomingHttpRequest', select: 'name' },
                { path: 'createdByIncomingHttpRequest', select: 'name' },
                { path: 'probes.probeId', select: 'probeName _id' },
            ];
            const select: $TSFixMe =
                'slug createdAt reason notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

            const [incidents, count]: $TSFixMe = await Promise.all([
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Fetch incidents by projectId
router.get(
    '/:projectId',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            // const subProjectIds: $TSFixMe = req.user.subProjects
            //     ? req.user.subProjects.map((project: $TSFixMe) =>  project._id)
            //     : null;
            const { projectId }: $TSFixMe = req.params;
            const incidents: $TSFixMe =
                await IncidentService.getSubProjectIncidents(projectId);
            return sendItemResponse(req, res, incidents); // frontend expects sendItemResponse
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

//Fetch incidents by component Id
router.get(
    '/:projectId/:componentId/incidents',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { componentId, projectId }: $TSFixMe = req.params;
            const incidents: $TSFixMe =
                await IncidentService.getComponentIncidents(
                    projectId,
                    componentId
                );
            return sendItemResponse(req, res, incidents); // frontend expects sendItemResponse
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
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
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId, componentId }: $TSFixMe = req.params;

            const incident: $TSFixMe =
                await IncidentService.getProjectComponentIncidents(
                    projectId,
                    componentId,
                    req.query['limit'] || 10,
                    req.query['skip'] || 0
                );
            return sendListResponse(req, res, incident); // frontend expects sendListResponse
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/incident',
    getUser,
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const projectId: $TSFixMe = req.params.projectId;
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
                { path: 'probes.probeId', select: 'probeName _id' },
            ];
            const select: $TSFixMe =
                'slug createdAt reason notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

            const monitors: $TSFixMe = await MonitorService.findBy({
                query: { projectId },
                select: '_id',
            });
            const monitorIds: $TSFixMe = monitors.map(
                (monitor: $TSFixMe) => monitor._id
            );

            const query: $TSFixMe = {
                'monitors.monitorId': { $in: monitorIds },
            };

            const [incident, count]: $TSFixMe = await Promise.all([
                IncidentService.findBy({
                    query,
                    limit: req.query['limit'] || 10,
                    skip: req.query['skip'] || 0,
                    select,
                    populate,
                }),
                IncidentService.countBy(query),
            ]);
            return sendListResponse(req, res, incident, count); // frontend expects sendListResponse
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: Getting incident.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.params-> {incidentSlug}
// Returns: 200: incidents, 400: Error; 500: Server Error.
router.get(
    '/:projectId/incident/:incidentSlug',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        // Call the IncidentService.

        try {
            const { incidentSlug }: $TSFixMe = req.params;
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
                { path: 'probes.probeId', select: 'probeName _id' },
            ];
            const select: $TSFixMe =
                'slug createdAt reason response notifications hideIncident acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

            const incident: $TSFixMe = await IncidentService.findOneBy({
                query: { slug: incidentSlug },
                select,
                populate,
            });
            return sendItemResponse(req, res, incident);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/timeline/:incidentId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { incidentId }: $TSFixMe = req.params;

            const populateIncTimeline: $TSFixMe = [
                { path: 'createdById', select: 'name' },
                {
                    path: 'probeId',
                    select: 'probeName probeImage',
                },
            ];
            const selectIncTimeline: $TSFixMe =
                'incidentId createdById probeId createdByZapier createdAt status incident_state';
            const [timeline, count]: $TSFixMe = await Promise.all([
                IncidentTimelineService.findBy({
                    query: { incidentId },
                    skip: req.query['skip'] || 0,
                    limit: req.query['limit'] || 10,
                    populate: populateIncTimeline,
                    select: selectIncTimeline,
                }),
                IncidentTimelineService.countBy({ incidentId }),
            ]);
            return sendListResponse(req, res, timeline, count); // frontend expects sendListResponse
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/unresolvedincidents',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const subProjectIds: $TSFixMe = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;
            // Call the IncidentService.

            const userId: $TSFixMe = req.user ? req.user.id : null;
            const { isHome }: $TSFixMe = req.query;
            const incident: $TSFixMe =
                await IncidentService.getUnresolvedIncidents(
                    subProjectIds,
                    userId,

                    isHome
                );
            return sendItemResponse(req, res, incident);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/acknowledge/:incidentId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const userId: $TSFixMe = req.user
                ? req.user.id === 'API'
                    ? null
                    : req.user.id
                : null;
            let acknowledgedByApi: $TSFixMe = false;

            if (req.user && req.user.id === 'API') {
                acknowledgedByApi = true;
            }
            const projectId: $TSFixMe = req.params.projectId;
            const incidentId: $TSFixMe = req.params.incidentId;

            const incident: $TSFixMe = await IncidentService.acknowledge(
                incidentId,
                userId,

                req.user.name,
                null,
                null,

                null,
                acknowledgedByApi
            );
            const populateIncidentMessage: $TSFixMe = [
                {
                    path: 'incidentId',
                    select: 'idNumber name slug',
                },
                { path: 'createdById', select: 'name' },
            ];

            const selectIncidentMessage: $TSFixMe =
                '_id updated postOnStatusPage createdAt content incidentId createdById type incident_state';

            const populateAlert: $TSFixMe = [
                { path: 'userId', select: 'name' },
                { path: 'monitorId', select: 'name' },
                { path: 'projectId', select: 'name' },
            ];

            const selectAlert: $TSFixMe =
                '_id projectId userId alertVia alertStatus eventType monitorId createdAt incidentId onCallScheduleStatus schedule escalation error errorMessage alertProgress deleted deletedAt deletedById';

            const populate: $TSFixMe = [
                { path: 'incidentId', select: 'name' },
                { path: 'projectId', select: 'name' },
                {
                    path: 'subscriberId',
                    select: 'name contactEmail contactPhone contactWebhook countryCode',
                },
            ];
            const select: $TSFixMe =
                'incidentId projectId subscriberId alertVia alertStatus eventType error errorMessage totalSubscribers identification';
            const selectOnCallScheduleStatus: $TSFixMe =
                'escalations createdAt project schedule activeEscalation activeEscalation incident incidentAcknowledged alertedEveryone isOnDuty deleted deletedAt deletedById';

            const populateOnCallScheduleStatus: $TSFixMe = [
                { path: 'incidentId', select: 'name slug' },
                { path: 'project', select: 'name slug' },
                { path: 'scheduleId', select: 'name slug' },
                { path: 'schedule', select: '_id name slug' },
                {
                    path: 'activeEscalationId',
                    select: 'projectId teams scheduleId',
                },
            ];

            const populateIncTimeline: $TSFixMe = [
                { path: 'createdById', select: 'name' },
                {
                    path: 'probeId',
                    select: 'probeName probeImage',
                },
            ];
            const selectIncTimeline: $TSFixMe =
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

            const [subAlerts, scheduleStatus]: $TSFixMe = await Promise.all([
                Services.deduplicate(subscriberAlerts),
                Services.checkCallSchedule(callScheduleStatus),
            ]);
            callScheduleStatus = scheduleStatus;

            const timelineAlerts: $TSFixMe = [
                ...timeline,
                ...alerts,
                ...incidentMessages,
            ].sort((a: $TSFixMe, b: $TSFixMe){
                return b.createdAt - a.createdAt;
            });
            incidentMessages = [
                ...timelineAlerts,
                ...subAlerts,
                ...callScheduleStatus,
            ];
            incidentMessages.sort(
                (a: $TSFixMe, b: $TSFixMe) =>
                    typeof a.schedule !== 'object' && b.createdAt - a.createdAt
            );
            const filteredMsg: $TSFixMe = incidentMessages.filter(
                (a: $TSFixMe) =>
                    a.status !== 'internal notes added' &&
                    a.status !== 'internal notes updated'
            );
            const result: $TSFixMe = {
                data: await Services.rearrangeDuty(filteredMsg),
                incident,
                type: 'internal',
            };
            return sendItemResponse(req, res, result);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
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
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const userId: $TSFixMe = req.user
                ? req.user.id === 'API'
                    ? null
                    : req.user.id
                : null;
            let resolvedByApi: $TSFixMe = false;

            if (req.user && req.user.id === 'API') {
                resolvedByApi = true;
            }
            const projectId: $TSFixMe = req.params.projectId;
            const incidentId: $TSFixMe = req.params.incidentId;

            const incident: $TSFixMe = await IncidentService.resolve(
                incidentId,
                userId,
                null,
                null,
                null,

                null,
                resolvedByApi
            );
            const populateIncidentMessage: $TSFixMe = [
                {
                    path: 'incidentId',
                    select: 'idNumber name slug',
                },
                { path: 'createdById', select: 'name' },
            ];

            const selectIncidentMessage: $TSFixMe =
                '_id updated postOnStatusPage createdAt content incidentId createdById type incident_state';

            const populateAlert: $TSFixMe = [
                { path: 'userId', select: 'name' },
                { path: 'monitorId', select: 'name' },
                { path: 'projectId', select: 'name' },
            ];

            const selectAlert: $TSFixMe =
                '_id projectId userId alertVia alertStatus eventType monitorId createdAt incidentId onCallScheduleStatus schedule escalation error errorMessage alertProgress deleted deletedAt deletedById';

            const populate: $TSFixMe = [
                { path: 'incidentId', select: 'name' },
                { path: 'projectId', select: 'name' },
                {
                    path: 'subscriberId',
                    select: 'name contactEmail contactPhone contactWebhook countryCode',
                },
            ];
            const select: $TSFixMe =
                'incidentId projectId subscriberId alertVia alertStatus eventType error errorMessage totalSubscribers identification';

            const selectOnCallScheduleStatus: $TSFixMe =
                'escalations createdAt project schedule activeEscalation activeEscalation incident incidentAcknowledged alertedEveryone isOnDuty deleted deletedAt deletedById';

            const populateOnCallScheduleStatus: $TSFixMe = [
                { path: 'incidentId', select: 'name slug' },
                { path: 'project', select: 'name slug' },
                { path: 'scheduleId', select: 'name slug' },
                { path: 'schedule', select: '_id name slug' },
                {
                    path: 'activeEscalationId',
                    select: 'projectId teams scheduleId',
                },
            ];
            const populateIncTimeline: $TSFixMe = [
                { path: 'createdById', select: 'name' },
                {
                    path: 'probeId',
                    select: 'probeName probeImage',
                },
            ];
            const selectIncTimeline: $TSFixMe =
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

            const [subAlerts, scheduleStatus]: $TSFixMe = await Promise.all([
                Services.deduplicate(subscriberAlerts),
                Services.checkCallSchedule(callScheduleStatus),
            ]);

            callScheduleStatus = scheduleStatus;

            const timelineAlerts: $TSFixMe = [
                ...timeline,
                ...alerts,
                ...incidentMessages,
            ].sort((a: $TSFixMe, b: $TSFixMe){
                return b.createdAt - a.createdAt;
            });
            incidentMessages = [
                ...timelineAlerts,
                ...subAlerts,
                ...callScheduleStatus,
            ];
            incidentMessages.sort(
                (a: $TSFixMe, b: $TSFixMe) =>
                    typeof a.schedule !== 'object' && b.createdAt - a.createdAt
            );
            const filteredMsg: $TSFixMe = incidentMessages.filter(
                (a: $TSFixMe) =>
                    a.status !== 'internal notes added' &&
                    a.status !== 'internal notes updated'
            );
            const result: $TSFixMe = {
                data: await Services.rearrangeDuty(filteredMsg),
                incident,
                type: 'internal',
            };

            return sendItemResponse(req, res, result);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/close/:incidentId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const userId: $TSFixMe = req.user ? req.user.id : null;
            const { incidentId }: $TSFixMe = req.params;
            // Call the IncidentService
            const incident: $TSFixMe = await IncidentService.close(
                incidentId,
                userId
            );
            return sendItemResponse(req, res, incident);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// update incident details
// title, description, priority and type
router.put(
    '/:projectId/incident/:incidentId/details',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const projectId: $TSFixMe = req.params.projectId;
        const incidentId: $TSFixMe = req.params.incidentId;
        const { title, description, incidentPriority }: $TSFixMe = req.body;

        const query: $TSFixMe = {
            title,
            description,
            incidentPriority,
        };

        if (!incidentId) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('incidentId must be set.')
            );
        }
        try {
            const incident: $TSFixMe = await IncidentService.updateOneBy(
                {
                    projectId,
                    _id: incidentId,
                },
                query
            );
            return sendItemResponse(req, res, incident);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
router.post(
    '/:projectId/incident/:incidentId/message',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = req.body;
            const incidentId: $TSFixMe = req.params.incidentId;
            const projectId: $TSFixMe = req.params.projectId;
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
                { path: 'probes.probeId', select: 'probeName _id' },
            ];
            const select: $TSFixMe =
                'slug createdAt reason notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

            const populateIncidentMessage: $TSFixMe = [
                {
                    path: 'incidentId',
                    select: 'idNumber name slug',
                },
                { path: 'createdById', select: 'name' },
            ];

            const selectIncidentMessage: $TSFixMe =
                '_id updated postOnStatusPage createdAt content incidentId createdById type incident_state';

            const incident: $TSFixMe = await IncidentService.findOneBy({
                query: { _id: incidentId },
                select,
                populate,
            });
            const idNumber: $TSFixMe = incident.idNumber;

            const userId: $TSFixMe = req.user.id;
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
                const incidentMsgCount: $TSFixMe =
                    await IncidentMessageService.countBy({
                        _id: data.id,
                    });

                if (!incidentMsgCount || incidentMsgCount === 0) {
                    return sendErrorResponse(req, res, {
                        code: 404,
                        message: 'Incident Message not found.',
                    });
                }
            }
            let incidentMessage: $TSFixMe = null;
            if (incident && incident._id) {
                data.incidentId = incidentId;

                const monitors: $TSFixMe = incident.monitors.map(
                    (monitor: $TSFixMe) => monitor.monitorId.name
                );
                const templateInput: $TSFixMe = {
                    time: moment(incident.createdAt).format('h:mm:ss a'),
                    date: moment(incident.createdAt).format('MMM Do YYYY'),
                    projectName: incident.projectId.name,
                    incidentType: incident.incidentType,
                    monitorName: joinNames(monitors),
                };
                const incidentStateTemplate: $TSFixMe = Handlebars.compile(
                    data.incident_state
                );
                const contentTemplate: $TSFixMe = Handlebars.compile(
                    data.content
                );

                data.incident_state = incidentStateTemplate(templateInput);
                data.content = contentTemplate(templateInput);

                // handle creation or updating
                if (!data.id) {
                    data.createdById = req.user.id;
                    data.monitors = incident.monitors.map(
                        (monitor: $TSFixMe) => monitor.monitorId
                    );
                    incidentMessage = await IncidentMessageService.create(data);
                    if (data.post_statuspage) {
                        AlertService.sendInvestigationNoteToSubscribers(
                            incident,
                            data,
                            'created',
                            projectId
                        ).catch((error: Error) => {
                            errorService.log(
                                'AlertService.sendInvestigationNoteToSubscribers',
                                error
                            );
                        });
                    }
                } else {
                    const updatedMessage: $TSFixMe = {
                        content: data.content,
                        incident_state: data.incident_state,
                    };

                    const [message, investigation]: $TSFixMe =
                        await Promise.all([
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
                        ).catch((error: Error) => {
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
                ).catch((error: Error) => {
                    errorService.log(
                        'IncidentAPI.sendInvestigationToProjectWebhooks',
                        error
                    );
                });
                const status: string = `${incidentMessage.type} notes ${
                    data.id ? 'updated' : 'added'
                }`;

                const user: $TSFixMe = await UserService.findOneBy({
                    query: { _id: userId },
                    select: 'name',
                });

                data.created_by =
                    user && user.name ? user.name : 'OneUptime User';

                const populateAlert: $TSFixMe = [
                    { path: 'userId', select: 'name' },
                    { path: 'monitorId', select: 'name' },
                    { path: 'projectId', select: 'name' },
                ];

                const selectAlert: $TSFixMe =
                    '_id projectId userId alertVia alertStatus eventType monitorId createdAt incidentId onCallScheduleStatus schedule escalation error errorMessage alertProgress deleted deletedAt deletedById';

                const populate: $TSFixMe = [
                    { path: 'incidentId', select: 'name' },
                    { path: 'projectId', select: 'name' },
                    {
                        path: 'subscriberId',
                        select: 'name contactEmail contactPhone contactWebhook countryCode',
                    },
                ];
                const select: $TSFixMe =
                    'incidentId projectId subscriberId alertVia alertStatus eventType error errorMessage totalSubscribers identification';
                const selectOnCallScheduleStatus: $TSFixMe =
                    'escalations createdAt project schedule activeEscalation activeEscalation incident incidentAcknowledged alertedEveryone isOnDuty deleted deletedAt deletedById';

                const populateOnCallScheduleStatus: $TSFixMe = [
                    { path: 'incidentId', select: 'name slug' },
                    { path: 'project', select: 'name slug' },
                    { path: 'scheduleId', select: 'name slug' },
                    { path: 'schedule', select: '_id name slug' },
                    {
                        path: 'activeEscalationId',
                        select: 'projectId teams scheduleId',
                    },
                ];

                const populateIncTimeline: $TSFixMe = [
                    { path: 'createdById', select: 'name' },
                    {
                        path: 'probeId',
                        select: 'probeName probeImage',
                    },
                ];
                const selectIncTimeline: $TSFixMe =
                    'incidentId createdById probeId createdByZapier createdAt status incident_state';
                const [alerts, subscriberAlerts]: $TSFixMe = await Promise.all([
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
                    const timelineAlerts: $TSFixMe = [
                        ...timeline,
                        ...alerts,
                        ...incidentMessages,
                    ].sort((a: $TSFixMe, b: $TSFixMe){
                        return b.createdAt - a.createdAt;
                    });
                    incidentMessages = [
                        ...timelineAlerts,
                        ...subAlerts,
                        ...callScheduleStatus,
                    ];
                    incidentMessages.sort(
                        (a: $TSFixMe, b: $TSFixMe) =>
                            typeof a.schedule !== 'object' &&
                            b.createdAt - a.createdAt
                    );
                    const filteredMsg: $TSFixMe = incidentMessages.filter(
                        (a: $TSFixMe) =>
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// fetches status pages for an incident
// returns a list of status pages pointing to the incident
router.get(
    '/:projectId/:incidentSlug/statuspages',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { incidentSlug }: $TSFixMe = req.params;

            const incident: $TSFixMe = await IncidentService.findOneBy({
                query: { slug: incidentSlug },
                select: '_id',
            });
            if (incident) {
                const { statusPages, count }: $TSFixMe =
                    await StatusPageService.getStatusPagesForIncident(
                        incident._id,

                        parseInt(req.query['skip']) || 0,

                        parseInt(req.query['limit']) || 10
                    );
                return sendListResponse(req, res, statusPages, count);
            } else {
                return sendListResponse(req, res, [], 0);
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId/incident/:incidentId/message/:incidentMessageId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { incidentId, incidentMessageId, projectId }: $TSFixMe =
                req.params;
            const populateIncidentMessage: $TSFixMe = [
                { path: 'incidentId', select: 'idNumber name slug' },
                { path: 'createdById', select: 'name' },
            ];

            const selectIncidentMessage: $TSFixMe =
                '_id updated postOnStatusPage createdAt content incidentId createdById type incident_state';

            const [incident, checkMsg, incidentMessage]: $TSFixMe =
                await Promise.all([
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
            const idNumber: $TSFixMe = incident.idNumber;
            let result: $TSFixMe;
            /* eslint-disable prefer-const */
            if (incidentMessage) {
                const status: string = `${incidentMessage.type} notes deleted`;

                try {
                    // RUN IN THE BACKGROUND
                    RealTimeService.deleteIncidentNote(incidentMessage);
                } catch (error) {
                    ErrorService.log(
                        'realtimeService.deleteIncidentNote',
                        error
                    );
                }

                const populateAlert: $TSFixMe = [
                    { path: 'userId', select: 'name' },
                    { path: 'monitorId', select: 'name' },
                    { path: 'projectId', select: 'name' },
                ];

                const selectAlert: $TSFixMe =
                    '_id projectId userId alertVia alertStatus eventType monitorId createdAt incidentId onCallScheduleStatus schedule escalation error errorMessage alertProgress deleted deletedAt deletedById';

                const populate: $TSFixMe = [
                    { path: 'incidentId', select: 'name' },
                    { path: 'projectId', select: 'name' },
                    {
                        path: 'subscriberId',
                        select: 'name contactEmail contactPhone contactWebhook countryCode',
                    },
                ];
                const select: $TSFixMe =
                    'incidentId projectId subscriberId alertVia alertStatus eventType error errorMessage totalSubscribers identification';

                const selectOnCallScheduleStatus: $TSFixMe =
                    'escalations createdAt project schedule activeEscalation activeEscalation incident incidentAcknowledged alertedEveryone isOnDuty deleted deletedAt deletedById';

                const populateOnCallScheduleStatus: $TSFixMe = [
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

                const populateIncTimeline: $TSFixMe = [
                    { path: 'createdById', select: 'name' },
                    {
                        path: 'probeId',
                        select: 'probeName probeImage',
                    },
                ];
                const selectIncTimeline: $TSFixMe =
                    'incidentId createdById probeId createdByZapier createdAt status incident_state';
                let [alerts, subscriberAlerts, callScheduleStatus] =
                    await Promise.all([
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
                    let [incidentMessages, timeline, subAlerts] =
                        await Promise.all([
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
                    const timelineAlerts: $TSFixMe = [
                        ...timeline,
                        ...alerts,
                        ...incidentMessages,
                    ].sort((a: $TSFixMe, b: $TSFixMe){
                        return b.createdAt - a.createdAt;
                    });
                    incidentMessages = [
                        ...timelineAlerts,
                        ...subAlerts,
                        ...callScheduleStatus,
                    ];
                    incidentMessages.sort(
                        (a: $TSFixMe, b: $TSFixMe) =>
                            typeof a.schedule !== 'object' &&
                            b.createdAt - a.createdAt
                    );
                    const filteredMsg: $TSFixMe = incidentMessages.filter(
                        (a: $TSFixMe) =>
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
router.get(
    '/:projectId/incident/:incidentSlug/message',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        let type: $TSFixMe = 'investigation';
        if (req.query.type && req.query.type === 'internal') {
            type = 'internal';
        }
        try {
            let incidentMessages,
                result = [],
                count = 0;
            const incidentSlug: $TSFixMe = req.params.incidentSlug;
            const projectId: $TSFixMe = req.params.projectId;
            let incidentId: $TSFixMe = await IncidentService.findOneBy({
                query: { slug: incidentSlug },
                select: '_id',
            });
            if (incidentId) {
                incidentId = incidentId._id;
                let skip: $TSFixMe = 0,
                    limit = 0;
                if (type === 'investigation') {
                    skip = req.query['skip'] || 0;

                    limit = req.query['limit'] || 10;
                }

                const populateIncidentMessage: $TSFixMe = [
                    {
                        path: 'incidentId',
                        select: 'idNumber name slug',
                    },
                    { path: 'createdById', select: 'name' },
                ];

                const selectIncidentMessage: $TSFixMe =
                    '_id updated postOnStatusPage createdAt content incidentId createdById type incident_state';
                const populateAlert: $TSFixMe = [
                    { path: 'userId', select: 'name' },
                    { path: 'monitorId', select: 'name' },
                    { path: 'projectId', select: 'name' },
                ];

                const selectAlert: $TSFixMe =
                    '_id projectId userId alertVia alertStatus eventType monitorId createdAt incidentId onCallScheduleStatus schedule escalation error errorMessage alertProgress deleted deletedAt deletedById';

                const populate: $TSFixMe = [
                    { path: 'incidentId', select: 'name' },
                    { path: 'projectId', select: 'name' },
                    {
                        path: 'subscriberId',
                        select: 'name contactEmail contactPhone contactWebhook countryCode',
                    },
                ];
                const select: $TSFixMe =
                    'incidentId projectId subscriberId alertVia alertStatus eventType error errorMessage totalSubscribers identification';

                const selectOnCallScheduleStatus: $TSFixMe =
                    'escalations createdAt project schedule activeEscalation activeEscalation incident incidentAcknowledged alertedEveryone isOnDuty deleted deletedAt deletedById';

                const populateOnCallScheduleStatus: $TSFixMe = [
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

                const populateIncTimeline: $TSFixMe = [
                    { path: 'createdById', select: 'name' },
                    {
                        path: 'probeId',
                        select: 'probeName probeImage',
                    },
                ];
                const selectIncTimeline: $TSFixMe =
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
                    const [subAlerts, scheduleStatus]: $TSFixMe =
                        await Promise.all([
                            Services.deduplicate(subscriberAlerts),
                            onCallScheduleStatusService.findBy({
                                query: { incident: incidentId },
                                select: selectOnCallScheduleStatus,
                                populate: populateOnCallScheduleStatus,
                            }),
                        ]);
                    const callScheduleStatus: $TSFixMe =
                        await Services.checkCallSchedule(scheduleStatus);
                    const timelineAlerts: $TSFixMe = [
                        ...timeline,
                        ...alerts,
                        ...incidentMessages,
                    ].sort((a: $TSFixMe, b: $TSFixMe){
                        return b.createdAt - a.createdAt;
                    });
                    incidentMessages = [
                        ...timelineAlerts,
                        ...subAlerts,
                        ...callScheduleStatus,
                    ];
                    incidentMessages.sort(
                        (a: $TSFixMe, b: $TSFixMe) =>
                            typeof a.schedule !== 'object' &&
                            b.createdAt - a.createdAt
                    );
                    const filteredMsg: $TSFixMe = incidentMessages.filter(
                        a =>
                            a.status !== 'internal notes added' &&
                            a.status !== 'internal notes updated'
                    );

                    result = await Services.rearrangeDuty(filteredMsg);
                }
            }
            return sendListResponse(req, res, result, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId/:incidentId',
    getUser,
    isUserAdmin,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const { projectId, incidentId }: $TSFixMe = req.params;
            const incident: $TSFixMe = await IncidentService.deleteBy(
                { _id: incidentId, projectId },

                req.user.id
            );
            if (incident) {
                // RUN IN THE BACKGROUND
                RealTimeService.deleteIncident(incident);

                return sendItemResponse(req, res, incident);
            } else {
                return sendErrorResponse(req, res, {
                    message: 'Incident not found',
                });
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/:incidentId',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId, incidentId }: $TSFixMe = req.params;
            const { hideIncident }: $TSFixMe = req.body;
            const result: $TSFixMe = await IncidentService.updateOneBy(
                {
                    projectId,
                    _id: incidentId,
                },
                { hideIncident }
            );
            const incident: $TSFixMe = {
                hideIncident: result.hideIncident,
            };
            return sendItemResponse(req, res, incident);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

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
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const userId: $TSFixMe = req.user ? req.user.id : null;

            // get incident properties to build url
            const { incidentId, projectId }: $TSFixMe = req.params;

            const [incident]: $TSFixMe = await Promise.all([
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
            return sendErrorResponse(req, res, error as Exception);
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
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const userId: $TSFixMe = req.user ? req.user.id : null;

            // get incident properties to build url
            const { incidentId, projectId }: $TSFixMe = req.params;

            const [incident]: $TSFixMe = await Promise.all([
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
