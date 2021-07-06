/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const moment = require('moment');
const Handlebars = require('handlebars');
const IncidentService = require('../services/incidentService');
const IncidentTimelineService = require('../services/incidentTimelineService');
const MonitorStatusService = require('../services/monitorStatusService');
const StatusPageService = require('../services/statusPageService');
const RealTimeService = require('../services/realTimeService');
const IncidentMessageService = require('../services/incidentMessageService');
const AlertService = require('../services/alertService');
const UserService = require('../services/userService');
const router = express.Router();

const { isAuthorized } = require('../middlewares/authorization');
const errorService = require('../services/errorService');
const isUserAdmin = require('../middlewares/project').isUserAdmin;
const getUser = require('../middlewares/user').getUser;

const getSubProjects = require('../middlewares/subProject').getSubProjects;

const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const subscriberAlertService = require('../services/subscriberAlertService');
const onCallScheduleStatusService = require('../services/onCallScheduleStatusService');
const Services = require('../utils/services');
const joinNames = require('../utils/joinNames');

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
            const userId = req.user ? req.user.id : null;
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
        // include date range
        try {
            const { startDate, endDate } = req.body;
            let query = {
                'monitors.monitorId': { $in: [req.params.monitorId] },
                projectId: req.params.projectId,
            };

            if (startDate && endDate) {
                const start = moment(startDate).toDate();
                const end = moment(endDate).toDate();
                query = {
                    'monitors.monitorId': { $in: [req.params.monitorId] },
                    projectId: req.params.projectId,
                    createdAt: { $gte: start, $lte: end },
                };
            }

            const [incidents, count] = await Promise.all([
                IncidentService.findBy(
                    query,
                    req.body.limit || 3,
                    req.body.skip || 0
                ),
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
        const subProjectIds = req.user.subProjects
            ? req.user.subProjects.map(project => project._id)
            : null;
        const incidents = await IncidentService.getSubProjectIncidents(
            subProjectIds
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
        const [incident, count] = await Promise.all([
            IncidentService.findBy(
                { projectId },
                req.query.limit || 10,
                req.query.skip || 0
            ),
            IncidentService.countBy({ projectId }),
        ]);
        return sendListResponse(req, res, incident, count); // frontend expects sendListResponse
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Route
// Description: Getting incident.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.params-> {incidentId}
// Returns: 200: incidents, 400: Error; 500: Server Error.
router.get(
    '/:projectId/incident/:incidentId',
    getUser,
    isAuthorized,
    async function(req, res) {
        // Call the IncidentService.

        try {
            const { projectId, incidentId } = req.params;
            const incident = await IncidentService.findOneBy({
                projectId,
                idNumber: incidentId,
            });
            return sendItemResponse(req, res, incident);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route
// Description: Getting incident
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.params-> {incidentIdNumber}
// Returns: 200: incidents, 400: Error; 500: Server Error.
router.get(
    '/:projectId/incidentNumber/:incidentIdNumber',
    getUser,
    isAuthorized,
    async function(req, res) {
        // Call the IncidentService.

        try {
            const incident = await IncidentService.findOneBy({
                projectId: req.params.projectId,
                idNumber: req.params.incidentIdNumber,
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

            // const incident = await IncidentService.findOneBy({
            //     projectId,
            //     idNumber: incidentId,
            // });
            const [timeline, count] = await Promise.all([
                IncidentTimelineService.findBy(
                    { incidentId },
                    req.query.skip || 0,
                    req.query.limit || 10
                ),
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
            const userId = req.user ? req.user.id : null;
            const projectId = req.params.projectId;

            /* eslint-disable prefer-const */
            let [
                incident,
                incidentMessages,
                timeline,
                alerts,
                subscriberAlerts,
                callScheduleStatus,
            ] = await Promise.all([
                IncidentService.acknowledge(
                    req.params.incidentId,
                    userId,
                    req.user.name
                ),
                IncidentMessageService.findBy({
                    incidentId: req.params.incidentId,
                    type: 'internal',
                }),
                IncidentTimelineService.findBy({
                    incidentId: req.params.incidentId,
                }),
                AlertService.findBy({
                    query: { incidentId: req.params.incidentId },
                }),
                subscriberAlertService.findBy({
                    incidentId: req.params.incidentId,
                    projectId,
                }),
                onCallScheduleStatusService.findBy({
                    query: { incident: req.params.incidentId },
                }),
            ]);
            /* eslint-enable prefer-const */

            const [subAlerts, scheduleStatus] = new Promise.all([
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
            const userId = req.user ? req.user.id : null;
            const projectId = req.params.projectId;
            /* eslint-disable prefer-const */
            let [
                incident,
                incidentMessages,
                timeline,
                alerts,
                subscriberAlerts,
                callScheduleStatus,
            ] = await Promise.all([
                IncidentService.resolve(req.params.incidentId, userId),
                IncidentMessageService.findBy({
                    incidentId: req.params.incidentId,
                    type: 'internal',
                }),
                IncidentTimelineService.findBy({
                    incidentId: req.params.incidentId,
                }),
                AlertService.findBy({
                    query: { incidentId: req.params.incidentId },
                }),
                subscriberAlertService.findBy({
                    incidentId: req.params.incidentId,
                    projectId,
                }),
                onCallScheduleStatusService.findBy({
                    query: { incident: req.params.incidentId },
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
            // Call the IncidentService
            const incident = await IncidentService.close(
                req.params.incidentId,
                userId
            );
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
            const incident = await IncidentService.findOneBy({
                _id: incidentId,
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
                const incidentMsg = await IncidentMessageService.findOneBy({
                    _id: data.id,
                });

                if (!incidentMsg) {
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
                            'created'
                        );
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
                            _id: data.id,
                        }),
                    ]);
                    incidentMessage = message;

                    if (investigation.type === 'investigation') {
                        AlertService.sendInvestigationNoteToSubscribers(
                            incident,
                            data,
                            'updated'
                        );
                    }
                }
                // send project webhook notification
                AlertService.sendStausPageNoteNotificationToProjectWebhooks(
                    req.params.projectId,
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
                    _id: userId,
                });

                data.created_by = user && user.name ? user.name : 'Fyipe User';

                const [alerts, subscriberAlerts] = await Promise.all([
                    AlertService.findBy({
                        query: { incidentId: incident._id },
                    }),
                    subscriberAlertService.findBy({
                        incidentId: incident._id,
                        projectId: req.params.projectId,
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
                            incidentId: incident._id,
                            type: data.type,
                        }),
                        IncidentTimelineService.findBy({
                            incidentId: incident._id,
                        }),
                        Services.deduplicate(subscriberAlerts),
                        onCallScheduleStatusService.findBy({
                            query: { incident: incident._id },
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
                    };
                } else {
                    incidentMessage = await IncidentMessageService.findOneBy({
                        _id: incidentMessage._id,
                        incidentId: incidentMessage.incidentId,
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
    '/:projectId/:incidentId/statuspages',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { projectId, incidentId } = req.params;

            const incident = await IncidentService.findOneBy({
                projectId,
                idNumber: incidentId,
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
            const [incident, checkMsg, incidentMessage] = await Promise.all([
                IncidentService.findOneBy({
                    _id: incidentId,
                }),
                IncidentMessageService.findOneBy({
                    _id: incidentMessageId,
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

                // RUN IN THE BACKGROUND
                RealTimeService.deleteIncidentNote(incidentMessage);

                let [
                    alerts,
                    subscriberAlerts,
                    callScheduleStatus,
                ] = await Promise.all([
                    AlertService.findBy({
                        query: { incidentId: incidentId },
                    }),
                    subscriberAlertService.findBy({
                        incidentId: incidentId,
                        projectId,
                    }),
                    onCallScheduleStatusService.findBy({
                        query: { incident: incidentId },
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
                            incidentId,
                            type: checkMsg.type,
                        }),
                        IncidentTimelineService.findBy({
                            incidentId,
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
    '/:projectId/incident/:incidentId/message',
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
            const idNumber = req.params.incidentId;
            const projectId = req.params.projectId;
            let incidentId = await IncidentService.findOneBy({
                projectId,
                idNumber,
            });
            if (incidentId) {
                incidentId = incidentId._id;
                let skip = 0,
                    limit = 0;
                if (type === 'investigation') {
                    skip = req.query.skip || 0;
                    limit = req.query.limit || 10;
                }
                const [
                    timeline,
                    alerts,
                    subscriberAlerts,
                    messageCount,
                    incMessages,
                ] = await Promise.all([
                    IncidentTimelineService.findBy({
                        incidentId,
                    }),
                    AlertService.findBy({
                        query: { incidentId: incidentId },
                    }),
                    subscriberAlertService.findBy({
                        incidentId: incidentId,
                        projectId,
                    }),
                    IncidentMessageService.countBy({
                        incidentId,
                        type,
                    }),
                    IncidentMessageService.findBy(
                        {
                            incidentId,
                            type,
                        },
                        skip,
                        limit
                    ),
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
            // RUN IN THE BACKGROUND
            RealTimeService.deleteIncident(incident);
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
        const incident = await IncidentService.updateOneBy(
            {
                projectId,
                _id: incidentId,
            },
            { hideIncident }
        );
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
                    projectId,
                    _id: incidentId,
                }),
                IncidentService.resolve(req.params.incidentId, userId),
            ]);

            const { projectId: project } = incident;

            return res.status(200).render('incidentAction.ejs', {
                title: 'Incident Resolved',
                title_message: 'Incident Resolved',
                body_message: 'Your incident is now resolved.',
                action: 'resolve',
                dashboard_url: `${global.dashboardHost}/project/${project.slug}/incidents/${incident.idNumber}`,
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
                    projectId,
                    _id: incidentId,
                }),
                IncidentService.acknowledge(
                    req.params.incidentId,
                    userId,
                    req.user.name
                ),
            ]);

            const { projectId: project } = incident;

            return res.status(200).render('incidentAction.ejs', {
                title: 'Incident Acknowledged',
                title_message: 'Incident Acknowledged',
                body_message: 'Your incident is now acknowledged.',
                action: 'acknowledge',
                dashboard_url: `${global.dashboardHost}/project/${project.slug}/incidents/${incident.idNumber}`,
                apiUrl: global.apiHost,
            });
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
