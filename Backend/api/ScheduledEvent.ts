import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
const router: $TSFixMe = express.getRouter();

import { isAuthorized } from '../middlewares/authorization';

import { getUser, checkUserBelongToProject } from '../middlewares/user';
import ScheduledEventService from '../services/scheduledEventService';
import AlertService from '../services/alertService';
import {
    sendErrorResponse,
    sendListResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import { getSubProjects } from '../middlewares/subProject';
import ScheduledEventNoteService from '../services/scheduledEventNoteService';
import moment from 'moment';
import MonitorService from '../services/monitorService';
import ErrorService from 'CommonServer/Utils/error';

router.post(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId: $TSFixMe = req.params.projectId;
            const data: $TSFixMe = req.body;

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

            const scheduledEvent: $TSFixMe = await ScheduledEventService.create(
                { projectId },
                data
            );

            return sendItemResponse(req, res, scheduledEvent);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/:eventId',
    getUser,
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const data: $TSFixMe = req.body;
            const { eventId, projectId }: $TSFixMe = req.params;

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

            const existingScheduledEvent: $TSFixMe =
                await ScheduledEventService.findOneBy({
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

            const scheduledEvent: $TSFixMe =
                await ScheduledEventService.updateOneBy(
                    { _id: eventId, projectId },
                    data
                );

            return sendItemResponse(req, res, scheduledEvent);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// resolve scheduled event
router.put(
    '/:projectId/resolve/:eventId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = {};

            data.resolvedBy = req.user ? req.user.id : null;
            const { eventId }: $TSFixMe = req.params;

            const scheduledEvent: $TSFixMe =
                await ScheduledEventService.findOneBy({
                    query: { _id: eventId },
                    select: 'startDate createdById',
                });
            const startDate: $TSFixMe = moment(
                scheduledEvent.startDate
            ).format();
            const currentDate: $TSFixMe = moment().format();

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

            const response: $TSFixMe =
                await ScheduledEventService.resolveScheduledEvent(
                    {
                        _id: eventId,
                    },
                    data
                );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId/:eventId',
    getUser,
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const userId: $TSFixMe = req.user ? req.user.id : null;
            const { eventId }: $TSFixMe = req.params;

            const event: $TSFixMe = await ScheduledEventService.deleteBy(
                { _id: eventId },
                userId
            );

            return sendItemResponse(req, res, event);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// cancel a scheduled event
router.put(
    '/:projectId/:eventId/cancel',
    getUser,
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const userId: $TSFixMe = req.user ? req.user.id : null;
            const { eventId }: $TSFixMe = req.params;

            const fetchEvent: $TSFixMe = await ScheduledEventService.findOneBy({
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

            const event: $TSFixMe = await ScheduledEventService.updateBy(
                { _id: eventId },
                {
                    cancelled: true,
                    cancelledAt: Date.now(),
                    cancelledById: userId,
                }
            );

            const scheduledEvent: $TSFixMe = event[0];

            if (scheduledEvent) {
                if (scheduledEvent.alertSubscriber) {
                    // handle this asynchronous operation in the background
                    AlertService.sendCancelledScheduledEventToSubscribers(
                        scheduledEvent
                    ).catch((error: Error) => {
                        ErrorService.log(
                            'AlertService.sendCancelledScheduledEventToSubscribers',
                            error
                        );
                    });
                }

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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// get ongoing scheduled events
router.get(
    '/:projectId/ongoingEvent',
    getUser,
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const { projectId }: $TSFixMe = req.params;
            const currentDate: $TSFixMe = moment();

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

            const populate: $TSFixMe = [
                { path: 'resolvedBy', select: 'name' },
                { path: 'projectId', select: 'name slug' },
                { path: 'createdById', select: 'name' },
                {
                    path: 'monitors.monitorId',
                    select: 'name',
                    populate: { path: 'componentId', select: 'name slug' },
                },
            ];
            const select: $TSFixMe =
                'cancelled showEventOnStatusPage callScheduleOnEvent monitorDuringEvent monitorDuringEvent recurring interval alertSubscriber resolved monitors name startDate endDate description createdById projectId slug createdAt ';

            const query: $TSFixMe = {
                projectId,
                startDate: { $lte: currentDate },
                endDate: { $gt: currentDate },
                resolved: false,
            };
            const [events, count]: $TSFixMe = await Promise.all([
                ScheduledEventService.findBy({
                    query,
                    select,
                    populate,
                }),
                ScheduledEventService.countBy(query),
            ]);
            return sendListResponse(req, res, events, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// this will handle getting for both projects and subProjects
router.get(
    '/:projectId/ongoingEvent/all',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const currentDate: $TSFixMe = moment();
            // this contains both projectIds and subProjectIds

            const subProjectIds: $TSFixMe = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => {
                      return project._id;
                  })
                : null;

            const ongoingScheduledEvents: $TSFixMe =
                await ScheduledEventService.getSubProjectOngoingScheduledEvents(
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/:eventId',
    getUser,
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const { projectId, eventId }: $TSFixMe = req.params;

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

            const populate: $TSFixMe = [
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
            const select: $TSFixMe =
                'cancelled showEventOnStatusPage callScheduleOnEvent monitorDuringEvent monitorDuringEvent recurring interval alertSubscriber resolved monitors name startDate endDate description createdById projectId slug createdAt ';

            const scheduledEvent: $TSFixMe =
                await ScheduledEventService.findOneBy({
                    query: { _id: eventId },
                    select,
                    populate,
                });
            return sendItemResponse(req, res, scheduledEvent);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId }: $TSFixMe = req.params;

            const query: $TSFixMe = req.query;

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

            const populate: $TSFixMe = [
                { path: 'resolvedBy', select: 'name' },
                { path: 'projectId', select: 'name slug' },
                { path: 'createdById', select: 'name' },
                {
                    path: 'monitors.monitorId',
                    select: 'name',
                    populate: { path: 'componentId', select: 'name slug' },
                },
            ];
            const select: $TSFixMe =
                'cancelled showEventOnStatusPage callScheduleOnEvent monitorDuringEvent monitorDuringEvent recurring interval alertSubscriber resolved monitors name startDate endDate description createdById projectId slug createdAt ';

            const [events, count]: $TSFixMe = await Promise.all([
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/scheduledEvents/all',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            // this contains both projectIds and subProjectIds

            const subProjectIds: $TSFixMe = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => {
                      return project._id;
                  })
                : null;

            const scheduledEvents: $TSFixMe =
                await ScheduledEventService.getSubProjectScheduledEvents(
                    subProjectIds
                );
            return sendItemResponse(req, res, scheduledEvents);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/:monitorId/statusPage',
    checkUserBelongToProject,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId: $TSFixMe = req.params.projectId;
            const monitorId: $TSFixMe = req.params.monitorId;

            const { limit, skip }: $TSFixMe = req.query;

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

            const populate: $TSFixMe = [
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
            const select: $TSFixMe =
                'cancelled showEventOnStatusPage callScheduleOnEvent monitorDuringEvent monitorDuringEvent recurring interval alertSubscriber resolved monitors name startDate endDate description createdById projectId slug createdAt ';

            const query: $TSFixMe = {
                projectId,
                monitorId,
                showEventOnStatusPage: true,
            };
            const [events, count]: $TSFixMe = await Promise.all([
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Scheduled Event Note

// Create a Scheduled Event note of type investigation or internal
router.post(
    '/:projectId/:eventId/notes',
    getUser,
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const { eventId, projectId }: $TSFixMe = req.params;

            const userId: $TSFixMe = req.user ? req.user.id : null;
            const data: $TSFixMe = req.body;
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
                    message:
                        'Scheduled Event Message type is not in string type.',
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

            const scheduledEventMessage: $TSFixMe =
                await ScheduledEventNoteService.create(data, projectId);

            return sendItemResponse(req, res, scheduledEventMessage);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Get all notes in a Scheduled Event (Used to fetch for investigation and internal types)
router.get(
    '/:projectId/:eventId/notes',
    getUser,
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const { eventId }: $TSFixMe = req.params;

            const { limit, skip }: $TSFixMe = req.query;

            const populate: $TSFixMe = [
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
            const selectFields: $TSFixMe =
                'updated content type event_state createdAt updatedAt createdById scheduledEventId';

            const [eventNotes, count]: $TSFixMe = await Promise.all([
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Update a particular note in Scheduled Event
router.put(
    '/:projectId/:eventId/notes/:noteId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { eventId, noteId, projectId }: $TSFixMe = req.params;
            const data: $TSFixMe = req.body;
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

            const scheduledEventMessage: $TSFixMe =
                await ScheduledEventNoteService.updateOneBy(
                    {
                        _id: noteId,
                        scheduledEventId: eventId,
                    },
                    data,
                    projectId
                );

            return sendItemResponse(req, res, scheduledEventMessage);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Delete a particular note in Scheduled Event
router.delete(
    '/:projectId/:eventId/notes/:noteId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { eventId, noteId, projectId }: $TSFixMe = req.params;

            const userId: $TSFixMe = req.user ? req.user.id : null;

            const deletedEventMessage: $TSFixMe =
                await ScheduledEventNoteService.deleteBy(
                    {
                        _id: noteId,
                        scheduledEventId: eventId,
                    },
                    userId,
                    projectId
                );
            return sendItemResponse(req, res, deletedEventMessage);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/slug/:slug',
    getUser,
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const { slug }: $TSFixMe = req.params;
            const populate: $TSFixMe = [
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
            const select: $TSFixMe =
                'cancelled showEventOnStatusPage callScheduleOnEvent monitorDuringEvent monitorDuringEvent recurring interval alertSubscriber resolved monitors name startDate endDate description createdById projectId slug createdAt ';

            const scheduledEvent: $TSFixMe =
                await ScheduledEventService.findOneBy({
                    query: { slug },
                    populate,
                    select,
                });

            return sendItemResponse(req, res, scheduledEvent);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
