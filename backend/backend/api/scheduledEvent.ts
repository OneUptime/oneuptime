import express from 'express';
const router = express.Router();
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../middlewares/authorization"' has no exp... Remove this comment to see the full error message
import { isAuthorized } from '../middlewares/authorization';
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../middlewares/user"' has no exported mem... Remove this comment to see the full error message
import { getUser, checkUserBelongToProject } from '../middlewares/user';
import ScheduledEventService from '../services/scheduledEventService';
import AlertService from '../services/alertService';
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../middlewares/subProject"' has no export... Remove this comment to see the full error message
import { getSubProjects } from '../middlewares/subProject';
import ScheduledEventNoteService from '../services/scheduledEventNoteService';
import moment from 'moment';
import MonitorService from '../services/monitorService';
import ErrorService from 'common-server/utils/error';

router.post('/:projectId', getUser, isAuthorized, async function(req, res) {
    try {
        const projectId = req.params.projectId;
        const data = req.body;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
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

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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
            query: { name: data.name, projectId },
            select: '_id createdById',
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolvedBy' does not exist on type '{}'.
            data.resolvedBy = req.user ? req.user.id : null;
            const { eventId } = req.params;

            const scheduledEvent = await ScheduledEventService.findOneBy({
                query: { _id: eventId },
                select: 'startDate createdById',
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
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

// cancel a scheduled event
router.put('/:projectId/:eventId/cancel', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
        const userId = req.user ? req.user.id : null;
        const { eventId } = req.params;

        const fetchEvent = await ScheduledEventService.findOneBy({
            query: { _id: eventId },
            select: 'resolved cancelled monitorDuringEvent monitors',
        });

        if (fetchEvent.resolved) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Event has already been resolved',
            });
        }

        if (fetchEvent.cancelled) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Event has already been cancelled',
            });
        }

        if (fetchEvent && !fetchEvent.monitorDuringEvent) {
            await MonitorService.markMonitorsAsShouldMonitor(
                fetchEvent.monitors.map((monitor: $TSFixMe) => {
                    return monitor.monitorId._id || monitor.monitorId;
                })
            );
        }

        const event = await ScheduledEventService.updateBy(
            { _id: eventId },
            {
                cancelled: true,
                cancelledAt: Date.now(),
                cancelledById: userId,
            }
        );

        const scheduledEvent = event[0];

        if (scheduledEvent) {
            if (scheduledEvent.alertSubscriber) {
                // handle this asynchronous operation in the background
                AlertService.sendCancelledScheduledEventToSubscribers(
                    scheduledEvent
                ).catch(error => {
                    ErrorService.log(
                        'AlertService.sendCancelledScheduledEventToSubscribers',
                        error
                    );
                });
            }

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
            await ScheduledEventNoteService.create({
                content: 'THIS SCHEDULED EVENT HAS BEEN CANCELLED',
                scheduledEventId: scheduledEvent._id,
                createdById: scheduledEvent.createdById._id,
                type: 'investigation',
                event_state: 'Cancelled',
            });
        }

        return sendItemResponse(req, res, scheduledEvent);
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

        const populate = [
            { path: 'resolvedBy', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'createdById', select: 'name' },
            {
                path: 'monitors.monitorId',
                select: 'name',
                populate: { path: 'componentId', select: 'name slug' },
            },
        ];
        const select =
            'cancelled showEventOnStatusPage callScheduleOnEvent monitorDuringEvent monitorDuringEvent recurring interval alertSubscriber resolved monitors name startDate endDate description createdById projectId slug createdAt ';

        const query = {
            projectId,
            startDate: { $lte: currentDate },
            endDate: { $gt: currentDate },
            resolved: false,
        };
        const [events, count] = await Promise.all([
            ScheduledEventService.findBy({
                query,
                select,
                populate,
            }),
            ScheduledEventService.countBy(query),
        ]);
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
            const subProjectIds = req.user.subProjects
                ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
                  req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;

            const ongoingScheduledEvents = await ScheduledEventService.getSubProjectOngoingScheduledEvents(
                subProjectIds,
                {
                    startDate: { $lte: currentDate },
                    endDate: { $gt: currentDate },
                    resolved: false,
                    cancelled: false,
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

        const populate = [
            { path: 'resolvedBy', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'createdById', select: 'name' },
            {
                path: 'monitors.monitorId',
                select: 'name',
                populate: {
                    path: 'componentId',
                    select: 'name slug',
                },
            },
        ];
        const select =
            'cancelled showEventOnStatusPage callScheduleOnEvent monitorDuringEvent monitorDuringEvent recurring interval alertSubscriber resolved monitors name startDate endDate description createdById projectId slug createdAt ';

        const scheduledEvent = await ScheduledEventService.findOneBy({
            query: { _id: eventId },
            select,
            populate,
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

        const populate = [
            { path: 'resolvedBy', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'createdById', select: 'name' },
            {
                path: 'monitors.monitorId',
                select: 'name',
                populate: { path: 'componentId', select: 'name slug' },
            },
        ];
        const select =
            'cancelled showEventOnStatusPage callScheduleOnEvent monitorDuringEvent monitorDuringEvent recurring interval alertSubscriber resolved monitors name startDate endDate description createdById projectId slug createdAt ';

        const [events, count] = await Promise.all([
            ScheduledEventService.findBy({
                query: { projectId },
                limit: query.limit,
                skip: query.skip,
                populate,
                select,
            }),
            ScheduledEventService.countBy({
                projectId,
            }),
        ]);
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
            const subProjectIds = req.user.subProjects
                ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
                  req.user.subProjects.map((project: $TSFixMe) => project._id)
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

            const { limit, skip } = req.query;

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

            const populate = [
                { path: 'resolvedBy', select: 'name' },
                { path: 'projectId', select: 'name slug' },
                { path: 'createdById', select: 'name' },
                {
                    path: 'monitors.monitorId',
                    select: 'name',
                    populate: {
                        path: 'componentId',
                        select: 'name slug',
                    },
                },
            ];
            const select =
                'cancelled showEventOnStatusPage callScheduleOnEvent monitorDuringEvent monitorDuringEvent recurring interval alertSubscriber resolved monitors name startDate endDate description createdById projectId slug createdAt ';

            const query = {
                projectId,
                monitorId,
                showEventOnStatusPage: true,
            };
            const [events, count] = await Promise.all([
                ScheduledEventService.findBy({
                    query,
                    limit,
                    skip,
                    select,
                    populate,
                }),
                ScheduledEventService.countBy(query),
            ]);
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
        const userId = req.user ? req.user.id : null;
        const data = req.body;
        data.scheduledEventId = eventId;
        data.createdById = userId;
        if (
            !data.scheduledEventId ||
            !data.scheduledEventId.trim() ||
            data.scheduledEventId === undefined ||
            data.scheduledEventId === 'undefined'
        ) {
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
        // eslint-disable-next-line no-unused-vars
        const { limit, skip, type } = req.query;

        const populate = [
            { path: 'createdById', select: 'name' },
            {
                path: 'scheduledEventId',
                select: 'name monitors alertSubscriber projectId',
                populate: {
                    path: 'projectId',
                    select: 'name replyAddress',
                },
            },
        ];
        const selectFields =
            'updated content type event_state createdAt updatedAt createdById scheduledEventId';

        const [eventNotes, count] = await Promise.all([
            ScheduledEventNoteService.findBy({
                query: { scheduledEventId: eventId },
                limit,
                skip,
                populate,
                select: selectFields,
            }),
            ScheduledEventNoteService.countBy({
                scheduledEventId: eventId,
            }),
        ]);

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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
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

router.get('/:projectId/slug/:slug', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const { slug } = req.params;
        const populate = [
            { path: 'resolvedBy', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'createdById', select: 'name' },
            {
                path: 'monitors.monitorId',
                select: 'name',
                populate: {
                    path: 'componentId',
                    select: 'name slug',
                },
            },
        ];
        const select =
            'cancelled showEventOnStatusPage callScheduleOnEvent monitorDuringEvent monitorDuringEvent recurring interval alertSubscriber resolved monitors name startDate endDate description createdById projectId slug createdAt ';

        const scheduledEvent = await ScheduledEventService.findOneBy({
            query: { slug },
            populate,
            select,
        });

        return sendItemResponse(req, res, scheduledEvent);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;
