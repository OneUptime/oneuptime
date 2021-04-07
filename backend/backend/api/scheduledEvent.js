const express = require('express');
const router = express.Router();
const { isAuthorized } = require('../middlewares/authorization');
const { getUser, checkUserBelongToProject } = require('../middlewares/user');
const ScheduledEventService = require('../services/scheduledEventService');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const { getSubProjects } = require('../middlewares/subProject');
const ScheduledEventNoteService = require('../services/scheduledEventNoteService');
const moment = require('moment');

router.post('/:projectId', getUser, isAuthorized, async function(req, res) {
    try {
        const projectId = req.params.projectId;
        const data = req.body;
        data.createdById = req.user ? req.user.id : null;

        if (!data) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: "Values can't be null",
            });
        }

        if (!data.name || !data.name.trim()) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Event name is required.',
            });
        }

        if (typeof data.name !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Event name is not of string type.',
            });
        }

        // data.monitors should be an array containing id of monitor(s)
        if (data.monitors && !Array.isArray(data.monitors)) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitors is not of type array',
            });
        }

        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID is required.',
            });
        }

        if (typeof projectId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID  is not of string type.',
            });
        }

        if (!data.startDate) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Start timestamp is required.',
            });
        }

        if (!data.endDate) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'End timestamp is required.',
            });
        }

        if (data.startDate > data.endDate) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Start date should always be less than End date',
            });
        }

        const scheduledEvent = await ScheduledEventService.create(
            { projectId },
            data
        );

        return sendItemResponse(req, res, scheduledEvent);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:eventId', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const data = req.body;
        const { eventId, projectId } = req.params;

        if (!data) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: "Values can't be null",
            });
        }

        if (!data.name || !data.name.trim()) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Event name is required.',
            });
        }

        if (typeof data.name !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Event name is not of string type.',
            });
        }

        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID is required.',
            });
        }

        if (typeof projectId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID  is not of string type.',
            });
        }

        if (!eventId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Event ID is required',
            });
        }

        if (typeof eventId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Event ID is not of string type',
            });
        }

        if (data.monitors && !Array.isArray(data.monitors)) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitors is not of type array',
            });
        }

        if (!data.startDate) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Start timestamp is required.',
            });
        }

        if (!data.endDate) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'End timestamp is required.',
            });
        }

        if (data.startDate > data.endDate) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Start date should always be less than End date',
            });
        }

        const existingScheduledEvent = await ScheduledEventService.findOneBy({
            name: data.name,
            projectId,
        });

        if (
            existingScheduledEvent &&
            String(existingScheduledEvent._id) !== String(eventId)
        ) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Scheduled event name already exists',
            });
        }

        const scheduledEvent = await ScheduledEventService.updateOneBy(
            { _id: eventId, projectId },
            data
        );

        return sendItemResponse(req, res, scheduledEvent);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// resolve scheduled event
router.put(
    '/:projectId/resolve/:eventId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const data = {};
            data.resolvedBy = req.user ? req.user.id : null;
            const { eventId } = req.params;

            const scheduledEvent = await ScheduledEventService.findOneBy({
                _id: eventId,
            });
            const startDate = moment(scheduledEvent.startDate).format();
            const currentDate = moment().format();

            if (startDate > currentDate) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:
                        'You can only resolve past or ongoing scheduled event',
                });
            }

            if (!scheduledEvent) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Scheduled event not found or does not exist.',
                });
            }

            const response = await ScheduledEventService.resolveScheduledEvent(
                {
                    _id: eventId,
                },
                data
            );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.delete('/:projectId/:eventId', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const userId = req.user ? req.user.id : null;
        const { eventId } = req.params;

        const event = await ScheduledEventService.deleteBy(
            { _id: eventId },
            userId
        );

        return sendItemResponse(req, res, event);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// get ongoing scheduled events
router.get('/:projectId/ongoingEvent', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const { projectId } = req.params;
        const currentDate = moment();

        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID is required.',
            });
        }

        if (typeof projectId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID is not of string type.',
            });
        }

        const events = await ScheduledEventService.findBy({
            projectId,
            startDate: { $lte: currentDate },
            endDate: { $gt: currentDate },
            resolved: false,
        });
        const count = await ScheduledEventService.countBy({
            projectId,
            startDate: { $lte: currentDate },
            endDate: { $gt: currentDate },
            resolved: false,
        });
        return sendListResponse(req, res, events, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// this will handle getting for both projects and subProjects
router.get(
    '/:projectId/ongoingEvent/all',
    getUser,
    isAuthorized,
    getSubProjects,
    async function(req, res) {
        try {
            const currentDate = moment();
            // this contains both projectIds and subProjectIds
            const subProjectIds = req.user.subProjects
                ? req.user.subProjects.map(project => project._id)
                : null;

            const ongoingScheduledEvents = await ScheduledEventService.getSubProjectOngoingScheduledEvents(
                subProjectIds,
                {
                    startDate: { $lte: currentDate },
                    endDate: { $gt: currentDate },
                    resolved: false,
                }
            );
            return sendItemResponse(req, res, ongoingScheduledEvents);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get('/:projectId/:eventId', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const { projectId, eventId } = req.params;

        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID is required.',
            });
        }

        if (typeof projectId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID is not of string type.',
            });
        }

        if (!eventId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Scheduled Event ID is required.',
            });
        }

        if (typeof eventId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Scheduled Event ID is not of string type.',
            });
        }

        const scheduledEvent = await ScheduledEventService.findOneBy({
            _id: eventId,
        });
        return sendItemResponse(req, res, scheduledEvent);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId', getUser, isAuthorized, async function(req, res) {
    try {
        const { projectId } = req.params;

        const query = req.query;

        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID is required.',
            });
        }

        if (typeof projectId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID is not of string type.',
            });
        }

        const events = await ScheduledEventService.findBy(
            { projectId },
            query.limit,
            query.skip
        );
        const count = await ScheduledEventService.countBy({
            projectId,
        });
        return sendListResponse(req, res, events, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get(
    '/:projectId/scheduledEvents/all',
    getUser,
    isAuthorized,
    getSubProjects,
    async function(req, res) {
        try {
            // this contains both projectIds and subProjectIds
            const subProjectIds = req.user.subProjects
                ? req.user.subProjects.map(project => project._id)
                : null;

            const scheduledEvents = await ScheduledEventService.getSubProjectScheduledEvents(
                subProjectIds
            );
            return sendItemResponse(req, res, scheduledEvents);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get(
    '/:projectId/:monitorId/statusPage',
    checkUserBelongToProject,
    async function(req, res) {
        try {
            const projectId = req.params.projectId;
            const monitorId = req.params.monitorId;

            const query = req.query;

            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project ID is required.',
                });
            }

            if (typeof projectId !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project ID is not of string type.',
                });
            }

            if (!monitorId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Monitor ID is required.',
                });
            }

            if (typeof monitorId !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Monitor ID is not of string type.',
                });
            }
            const events = await ScheduledEventService.findBy(
                { projectId, monitorId, showEventOnStatusPage: true },
                query.limit,
                query.skip
            );
            const count = await ScheduledEventService.countBy({
                projectId,
                monitorId,
                showEventOnStatusPage: true,
            });
            return sendListResponse(req, res, events, count);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Scheduled Event Note

// Create a Scheduled Event note of type investigation or internal
router.post('/:projectId/:eventId/notes', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const { eventId, projectId } = req.params;
        const userId = req.user ? req.user.id : null;
        const data = req.body;
        data.scheduledEventId = eventId;
        data.createdById = userId;

        if (!data.scheduledEventId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Scheduled Event ID is required.',
            });
        }

        if (typeof data.scheduledEventId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Scheduled Event ID is not of type string.',
            });
        }

        if (!data.content || !data.content.trim()) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Scheduled Event Message is required.',
            });
        }

        if (typeof data.content !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Scheduled Event Message is not in string type.',
            });
        }

        if (!data.event_state || !data.event_state.trim()) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Scheduled Event State is required.',
            });
        }

        if (typeof data.event_state !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Scheduled Event State is not in string type.',
            });
        }

        if (!data.type || !data.type.trim()) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Scheduled Event Message type is required.',
            });
        }

        if (typeof data.type !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Scheduled Event Message type is not in string type.',
            });
        }

        if (!['investigation', 'internal'].includes(data.type)) {
            return sendErrorResponse(req, res, {
                code: 400,
                message:
                    'Scheduled Event Message type should be of type investigation or internal.',
            });
        }

        if (data.external_note === true) {
            data.type = 'investigation';
        }

        const scheduledEventMessage = await ScheduledEventNoteService.create(
            data,
            projectId
        );

        return sendItemResponse(req, res, scheduledEventMessage);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Get all notes in a Scheduled Event (Used to fetch for investigation and internal types)
router.get('/:projectId/:eventId/notes', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const { eventId } = req.params;
        const { limit, skip } = req.query;

        const eventNotes = await ScheduledEventNoteService.findBy(
            { scheduledEventId: eventId },
            limit,
            skip
        );

        const count = await ScheduledEventNoteService.countBy({
            scheduledEventId: eventId,
        });
        return sendListResponse(req, res, eventNotes, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Update a particular note in Scheduled Event
router.put(
    '/:projectId/:eventId/notes/:noteId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { eventId, noteId, projectId } = req.params;
            const data = req.body;
            data.updated = true;

            if (!eventId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Scheduled Event ID is required.',
                });
            }

            if (typeof eventId !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Scheduled Event ID is not of type string.',
                });
            }

            if (!noteId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Scheduled Event Message ID is required.',
                });
            }

            if (typeof noteId !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:
                        'Scheduled Event Message ID is not of type string.',
                });
            }

            if (!data.content || !data.content.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Scheduled Event Message is required.',
                });
            }

            if (typeof data.content !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Scheduled Event Message is not in string type.',
                });
            }

            if (!data.event_state || !data.event_state.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Scheduled Event State is required.',
                });
            }

            if (typeof data.event_state !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Scheduled Event State is not in string type.',
                });
            }

            const scheduledEventMessage = await ScheduledEventNoteService.updateOneBy(
                {
                    _id: noteId,
                    scheduledEventId: eventId,
                },
                data,
                projectId
            );

            return sendItemResponse(req, res, scheduledEventMessage);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Delete a particular note in Scheduled Event
router.delete(
    '/:projectId/:eventId/notes/:noteId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { eventId, noteId, projectId } = req.params;
            const userId = req.user ? req.user.id : null;

            const deletedEventMessage = await ScheduledEventNoteService.deleteBy(
                {
                    _id: noteId,
                    scheduledEventId: eventId,
                },
                userId,
                projectId
            );
            return sendItemResponse(req, res, deletedEventMessage);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
