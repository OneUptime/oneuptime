const ScheduledEventModel = require('../models/scheduledEvent');
const UserModel = require('../models/user');
const ErrorService = require('../../../common-server/utils/errorService');
const RealTimeService = require('./realTimeService');
const ScheduledEventNoteService = require('./scheduledEventNoteService');
const AlertService = require('./alertService');
const moment = require('moment');
const getSlug = require('../utils/getSlug');
const MonitorService = require('./monitorService');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');

module.exports = {
    create: async function({ projectId }, data, recurring) {
        if (!data.monitors || data.monitors.length === 0) {
            const error = new Error(
                'You need at least one monitor to create a scheduled event'
            );
            error.code = 400;
            throw error;
        }
        if (!isArrayUnique(data.monitors)) {
            const error = new Error(
                'You cannot have multiple selection of a monitor'
            );
            error.code = 400;
            throw error;
        }

        // reassign data.monitors with a restructured monitor data
        data.monitors = data.monitors.map(monitor => ({
            monitorId: monitor,
        }));

        data.projectId = projectId;
        if (data && data.name) {
            data.slug = getSlug(data.name);
        }

        let scheduledEvent = await ScheduledEventModel.create({
            ...data,
        });

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

        scheduledEvent = await this.findOneBy({
            query: { _id: scheduledEvent._id },
            select,
            populate,
        });
        // add note when a scheduled event is created
        await ScheduledEventNoteService.create({
            content: scheduledEvent.description,
            scheduledEventId: scheduledEvent._id,
            createdById: scheduledEvent.createdById._id,
            type: 'investigation',
            event_state: 'Created',
        });

        //Create event start note immediately if start time equal to create time
        const currentTime = moment();
        const startTime = moment(scheduledEvent.startDate);
        if (startTime <= currentTime) {
            //set monitoring state of the monitor
            if (!data.monitorDuringEvent) {
                if (data.monitors && data.monitors.length > 0) {
                    await MonitorService.markMonitorsAsShouldNotMonitor(
                        data.monitors.map(i => i.monitorId._id || i.monitorId)
                    );
                }
            } else {
                if (data.monitors && data.monitors.length > 0) {
                    await MonitorService.markMonitorsAsShouldMonitor(
                        data.monitors.map(i => i.monitorId._id || i.monitorId)
                    );
                }
            }

            await ScheduledEventNoteService.create({
                content: 'This scheduled event has started',
                scheduledEventId: scheduledEvent._id,
                type: 'investigation',
                event_state: 'Started',
            });
        }

        //Create event end note immediately if end time equal to create time
        const endTime = moment(scheduledEvent.endDate);
        if (endTime <= currentTime) {
            // revert monitor to monitoring state
            if (!data.monitorDuringEvent) {
                await MonitorService.markMonitorsAsShouldMonitor(
                    data.monitors.map(i => i.monitorId._id || i.monitorId)
                );
            }

            await ScheduledEventNoteService.create({
                content: 'This scheduled event has ended',
                scheduledEventId: scheduledEvent._id,
                type: 'investigation',
                event_state: 'Ended',
            });
        }
        if (scheduledEvent.alertSubscriber) {
            // handle this asynchronous operation in the background
            AlertService.sendCreatedScheduledEventToSubscribers(
                scheduledEvent
            ).catch(error => {
                ErrorService.log(
                    'AlertService.sendCreatedScheduledEventToSubscribers',
                    error
                );
            });
        }

        if (!recurring) {
            // run in the background
            RealTimeService.addScheduledEvent(scheduledEvent);
        }
        return scheduledEvent;
    },

    updateOneBy: async function(query, data) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;

        if (!data.monitors || data.monitors.length === 0) {
            const error = new Error(
                'You need at least one monitor to update a scheduled event'
            );
            error.code = 400;
            throw error;
        }

        if (!isArrayUnique(data.monitors)) {
            const error = new Error(
                'You cannot have multiple selection of a monitor'
            );
            error.code = 400;
            throw error;
        }

        // reassign data.monitors with a restructured monitor data
        data.monitors = data.monitors.map(monitor => ({
            monitorId: monitor,
        }));

        if (!data.monitorDuringEvent) {
            await MonitorService.markMonitorsAsShouldNotMonitor(
                data.monitors.map(i => i.monitorId._id || i.monitorId)
            );
        } else {
            await MonitorService.markMonitorsAsShouldMonitor(
                data.monitors.map(i => i.monitorId._id || i.monitorId)
            );
        }

        if (data && data.name) {
            data.slug = getSlug(data.name);
        }
        let updatedScheduledEvent = await ScheduledEventModel.findOneAndUpdate(
            { _id: query._id },
            {
                $set: data,
            },
            { new: true }
        );

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

        updatedScheduledEvent = await this.findOneBy({
            query: { _id: updatedScheduledEvent._id },
            populate,
            select,
        });

        if (!updatedScheduledEvent) {
            const error = new Error(
                'Scheduled Event not found or does not exist'
            );
            error.code = 400;
            throw error;
        }

        // run in the background
        RealTimeService.updateScheduledEvent(updatedScheduledEvent);

        return updatedScheduledEvent;
    },

    updateBy: async function(query, data) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let updatedData = await ScheduledEventModel.updateMany(query, {
            $set: data,
        });

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

        updatedData = await this.findBy({ query, populate, select });

        return updatedData;
    },

    deleteBy: async function(query, userId) {
        const scheduledEvent = await ScheduledEventModel.findOneAndUpdate(
            query,
            {
                $set: {
                    deleted: true,
                    deletedAt: Date.now(),
                    deletedById: userId,
                },
            },
            { new: true }
        );

        if (scheduledEvent && !scheduledEvent.monitorDuringEvent) {
            await MonitorService.markMonitorsAsShouldMonitor(
                scheduledEvent.monitors.map(i => i.monitorId._id || i.monitorId)
            );
        }

        if (!scheduledEvent) {
            const error = new Error(
                'Scheduled Event not found or does not exist'
            );
            error.code = 400;
            throw error;
        }

        // run in the background
        RealTimeService.deleteScheduledEvent(scheduledEvent);

        return scheduledEvent;
    },

    findBy: async function({ query, limit, skip, populate, select }) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') {
            skip = Number(skip);
        }

        if (typeof limit === 'string') {
            limit = Number(limit);
        }

        if (!query) {
            query = {};
        }

        query.deleted = false;
        let scheduledEventQuery = ScheduledEventModel.find(query)
            .limit(limit)
            .skip(skip)
            .sort({ createdAt: -1 })
            .lean();

        scheduledEventQuery = handleSelect(select, scheduledEventQuery);
        scheduledEventQuery = handlePopulate(populate, scheduledEventQuery);

        const scheduledEvents = await scheduledEventQuery;

        return scheduledEvents;
    },

    findOneBy: async function({ query, select, populate }) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        let scheduledEventQuery = ScheduledEventModel.findOne(query).lean();

        scheduledEventQuery = handleSelect(select, scheduledEventQuery);
        scheduledEventQuery = handlePopulate(populate, scheduledEventQuery);

        const scheduledEvent = await scheduledEventQuery;

        if (scheduledEvent) {
            if (scheduledEvent.createdById === 'API') {
                scheduledEvent.createdById = {
                    name: 'API',
                    _id: null,
                };
            } else {
                const user = await UserModel.findOne({
                    _id: scheduledEvent.createdById,
                }).lean();

                scheduledEvent.createdById = {
                    _id: user._id,
                    name: user.name,
                };
            }
        }

        return scheduledEvent;
    },

    getSubProjectScheduledEvents: async function(subProjectIds) {
        const populateScheduledEvent = [
            { path: 'resolvedBy', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'createdById', select: 'name' },
            {
                path: 'monitors.monitorId',
                select: 'name',
                populate: { path: 'componentId', select: 'name slug' },
            },
        ];
        const selectScheduledEvent =
            'cancelled showEventOnStatusPage callScheduleOnEvent monitorDuringEvent monitorDuringEvent recurring interval alertSubscriber resolved monitors name startDate endDate description createdById projectId slug createdAt ';

        const subProjectScheduledEvents = await Promise.all(
            subProjectIds.map(async id => {
                const scheduledEvents = await this.findBy({
                    query: { projectId: id },
                    limit: 10,
                    skip: 0,
                    populate: populateScheduledEvent,
                    select: selectScheduledEvent,
                });
                const count = await this.countBy({ projectId: id });
                return {
                    scheduledEvents,
                    count,
                    project: id,
                    skip: 0,
                    limit: 10,
                };
            })
        );
        return subProjectScheduledEvents;
    },

    getSubProjectOngoingScheduledEvents: async function(subProjectIds, query) {
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

        const subProjectOngoingScheduledEvents = await Promise.all(
            subProjectIds.map(async id => {
                const ongoingScheduledEvents = await this.findBy({
                    query: { projectId: id, ...query },
                    populate,
                    select,
                });
                const count = await this.countBy({
                    projectId: id,
                    ...query,
                });
                return {
                    ongoingScheduledEvents,
                    count,
                    project: id,
                };
            })
        );

        return subProjectOngoingScheduledEvents;
    },

    countBy: async function(query) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        const count = await ScheduledEventModel.countDocuments(query);
        return count;
    },

    hardDeleteBy: async function(query) {
        await ScheduledEventModel.deleteMany(query);
        return 'Event(s) removed successfully!';
    },

    /**
     * @description removes a particular monitor from scheduled event
     * @description if no monitor remains after deletion, then the scheduled event is deleted
     * @param {string} monitorId the id of the monitor
     * @param {string} userId the id of the user
     */
    removeMonitor: async function(monitorId, userId) {
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

        const scheduledEvents = await this.findBy({
            query: { 'monitors.monitorId': monitorId },
            populate,
            select,
        });

        const _this = this;
        await Promise.all(
            scheduledEvents.map(async event => {
                // remove the monitor from scheduled event monitors list
                event.monitors = event.monitors.filter(
                    monitor =>
                        String(monitor.monitorId._id) !== String(monitorId)
                );

                if (event.monitors.length > 0) {
                    let updatedEvent = await ScheduledEventModel.findOneAndUpdate(
                        { _id: event._id },
                        { $set: { monitors: event.monitors } },
                        { new: true }
                    );

                    updatedEvent = await _this.findOneBy({
                        query: { _id: updatedEvent._id },
                        select,
                        populate,
                    });

                    RealTimeService.updateScheduledEvent(updatedEvent);
                } else {
                    // delete the scheduled event when no monitor is remaining
                    let deletedEvent = await ScheduledEventModel.findOneAndUpdate(
                        { _id: event._id },
                        {
                            $set: {
                                monitors: event.monitors,
                                deleted: true,
                                deletedAt: Date.now(),
                                deletedById: userId,
                            },
                        },
                        { new: true }
                    );
                    deletedEvent = await deletedEvent
                        .populate('monitors.monitorId', 'name')
                        .populate('projectId', 'name')
                        .populate('createdById', 'name')
                        .execPopulate();

                    RealTimeService.deleteScheduledEvent(deletedEvent);
                }
            })
        );
    },

    /**
     * @description resolves a particular scheduled event
     * @param {object} query query parameter to use for db manipulation
     * @param {object} data data to be used to update the schedule
     */
    resolveScheduledEvent: async function(query, data) {
        const _this = this;
        data.resolved = true;
        data.resolvedAt = Date.now();
        let resolvedScheduledEvent = await ScheduledEventModel.findOneAndUpdate(
            query,
            { $set: data },
            { new: true }
        );
        if (
            resolvedScheduledEvent &&
            !resolvedScheduledEvent.monitorDuringEvent
        ) {
            await MonitorService.markMonitorsAsShouldMonitor(
                resolvedScheduledEvent.monitors.map(monitor => {
                    return monitor.monitorId._id || monitor.monitorId;
                })
            );
        }

        if (resolvedScheduledEvent.recurring) {
            let newStartDate;
            let newEndDate;
            const startDate = resolvedScheduledEvent.startDate;
            const endDate = resolvedScheduledEvent.endDate;
            if (resolvedScheduledEvent.interval === 'daily') {
                newStartDate = moment(startDate).add(1, 'days');
                newEndDate = moment(endDate).add(1, 'days');
            } else if (resolvedScheduledEvent.interval === 'weekly') {
                newStartDate = moment(startDate).add(7, 'days');
                newEndDate = moment(endDate).add(7, 'days');
            } else if (resolvedScheduledEvent.interval === 'monthly') {
                newStartDate = moment(startDate).add(1, 'months');
                newEndDate = moment(endDate).add(1, 'months');
            }
            const postObj = {};
            postObj.name = resolvedScheduledEvent.name;
            postObj.startDate = newStartDate;
            postObj.endDate = newEndDate;
            postObj.description = resolvedScheduledEvent.description;
            postObj.showEventOnStatusPage =
                resolvedScheduledEvent.showEventOnStatusPage;
            postObj.callScheduleOnEvent =
                resolvedScheduledEvent.callScheduleOnEvent;
            postObj.monitorDuringEvent =
                resolvedScheduledEvent.monitorDuringEvent;
            postObj.alertSubscriber = resolvedScheduledEvent.alertSubscriber;
            postObj.recurring = resolvedScheduledEvent.recurring;
            postObj.showAdvance = resolvedScheduledEvent.showAdvance;
            postObj.interval = resolvedScheduledEvent.interval;
            postObj.createdById = resolvedScheduledEvent.createdById;
            const projectId = resolvedScheduledEvent.projectId;
            const monitors = resolvedScheduledEvent.monitors.map(
                monitor => monitor.monitorId
            );
            postObj.monitors = monitors;
            _this.create({ projectId }, postObj, true);
        }
        // populate the necessary data
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
            'cancelled showEventOnStatusPage callScheduleOnEvent monitorDuringEvent monitorDuringEvent recurring interval alertSubscriber resolved monitors name startDate endDate description createdById projectId slug createdAt';

        resolvedScheduledEvent = await _this.findOneBy({
            query: { _id: resolvedScheduledEvent._id },
            select,
            populate,
        });

        // add note automatically
        // when a scheduled event is resolved
        await ScheduledEventNoteService.create({
            content: 'This scheduled event has been resolved',
            scheduledEventId: query._id,
            createdById: data.resolvedBy,
            type: 'investigation',
            event_state: 'Resolved',
        });

        if (resolvedScheduledEvent.alertSubscriber) {
            // handle this asynchronous operation in the background
            AlertService.sendResolvedScheduledEventToSubscribers(
                resolvedScheduledEvent
            ).catch(error => {
                ErrorService.log(
                    'AlertService.sendResolvedScheduledEventToSubscribers',
                    error
                );
            });
        }

        // realtime update
        // run in the background
        RealTimeService.resolveScheduledEvent(resolvedScheduledEvent);

        return resolvedScheduledEvent;
    },
    /**
     * @description Create Started note for all schedule events
     */
    createScheduledEventStartedNote: async function() {
        const currentTime = moment();

        //fetch events that have started
        const scheduledEventList = await this.findBy({
            query: {
                startDate: { $lte: currentTime },
                endDate: { $gte: currentTime },
                deleted: false,
                cancelled: false,
            },
            limit: 0,
            skip: 0,
            select: '_id monitorDuringEvent monitors',
        });

        scheduledEventList.map(async scheduledEvent => {
            const scheduledEventId = scheduledEvent._id;

            // set monitoring status of the monitor
            if (!scheduledEvent.monitorDuringEvent) {
                if (
                    scheduledEvent.monitors &&
                    scheduledEvent.monitors.length > 0
                ) {
                    await MonitorService.markMonitorsAsShouldNotMonitor(
                        scheduledEvent.monitors.map(
                            i => i.monitorId._id || i.monitorId
                        )
                    );
                }
            } else {
                if (
                    scheduledEvent.monitors &&
                    scheduledEvent.monitors.length > 0
                ) {
                    await MonitorService.markMonitorsAsShouldMonitor(
                        scheduledEvent.monitors.map(
                            i => i.monitorId._id || i.monitorId
                        )
                    );
                }
            }

            const scheduledEventNoteCount = await ScheduledEventNoteService.countBy(
                {
                    scheduledEventId,
                    event_state: 'Started',
                }
            );
            if (scheduledEventNoteCount === 0) {
                await ScheduledEventNoteService.create({
                    content: 'This scheduled event has started',
                    scheduledEventId,
                    type: 'investigation',
                    event_state: 'Started',
                });
            }
        });
    },

    /**
     * @description Create Ended note for all schedule events
     */ createScheduledEventEndedNote: async function() {
        const currentTime = moment();

        //fetch events that have ended
        const scheduledEventList = await this.findBy({
            query: {
                endDate: { $lte: currentTime },
                deleted: false,
                cancelled: false,
            },
            limit: 0,
            skip: 0,
            select: '_id monitorDuringEvent monitors',
        });
        scheduledEventList.map(async scheduledEvent => {
            const scheduledEventId = scheduledEvent._id;

            // revert monitor back to monitoring state
            if (scheduledEvent && !scheduledEvent.monitorDuringEvent) {
                if (
                    scheduledEvent.monitors &&
                    scheduledEvent.monitors.length > 0
                ) {
                    await MonitorService.markMonitorsAsShouldMonitor(
                        scheduledEvent.monitors.map(
                            i => i.monitorId._id || i.monitorId
                        )
                    );
                }
            }

            const scheduledEventNoteListCount = await ScheduledEventNoteService.countBy(
                {
                    scheduledEventId,
                    event_state: 'Ended',
                }
            );
            if (scheduledEventNoteListCount === 0) {
                await ScheduledEventNoteService.create({
                    content: 'This scheduled event has ended',
                    scheduledEventId,
                    type: 'investigation',
                    event_state: 'Ended',
                });
            }
        });
    },
};

/**
 * @description checks if an array contains duplicate values
 * @param {array} myArray the array to be checked
 * @returns {boolean} true or false
 */
function isArrayUnique(myArray) {
    return myArray.length === new Set(myArray).size;
}
