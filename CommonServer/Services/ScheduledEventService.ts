import ScheduledEventModel from '../Models/scheduledEvent';
import ObjectID from 'Common/Types/ObjectID';
import UserModel from '../Models/user';
import ErrorService from '../Utils/error';
import RealTimeService from './realTimeService';
import ScheduledEventNoteService from './ScheduledEventNoteService';
import AlertService from './AlertService';
import moment from 'moment';
import getSlug from '../Utils/getSlug';
import MonitorService from './MonitorService';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';

export default class Service {
    public async create(
        { projectId }: $TSFixMe,
        data: $TSFixMe,
        recurring: $TSFixMe
    ): void {
        if (!data.monitors || data.monitors.length === 0) {
            const error: $TSFixMe = new Error(
                'You need at least one monitor to create a scheduled event'
            );

            error.code = 400;
            throw error;
        }
        if (!isArrayUnique(data.monitors)) {
            const error: $TSFixMe = new Error(
                'You cannot have multiple selection of a monitor'
            );

            error.code = 400;
            throw error;
        }

        // Reassign data.monitors with a restructured monitor data
        data.monitors = data.monitors.map((monitor: $TSFixMe) => {
            return {
                monitorId: monitor,
            };
        });

        data.projectId = projectId;
        if (data && data.name) {
            data.slug = getSlug(data.name);
        }

        let scheduledEvent: $TSFixMe = await ScheduledEventModel.create({
            ...data,
        });

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

        scheduledEvent = await this.findOneBy({
            query: { _id: scheduledEvent._id },
            select,
            populate,
        });
        // Add note when a scheduled event is created

        await ScheduledEventNoteService.create({
            content: scheduledEvent.description,
            scheduledEventId: scheduledEvent._id,

            createdById: scheduledEvent.createdById._id,
            type: 'investigation',
            event_state: 'Created',
        });

        //Create event start note immediately if start time equal to create time
        const currentTime: $TSFixMe = moment();

        const startTime: $TSFixMe = moment(scheduledEvent.startDate);
        if (startTime <= currentTime) {
            //Set monitoring state of the monitor
            if (!data.monitorDuringEvent) {
                if (data.monitors && data.monitors.length > 0) {
                    await MonitorService.markMonitorsAsShouldNotMonitor(
                        data.monitors.map((i: $TSFixMe) => {
                            return i.monitorId._id || i.monitorId;
                        })
                    );
                }
            } else if (data.monitors && data.monitors.length > 0) {
                await MonitorService.markMonitorsAsShouldMonitor(
                    data.monitors.map((i: $TSFixMe) => {
                        return i.monitorId._id || i.monitorId;
                    })
                );
            }

            await ScheduledEventNoteService.create({
                content: 'This scheduled event has started',
                scheduledEventId: scheduledEvent._id,
                type: 'investigation',
                event_state: 'Started',
            });
        }

        //Create event end note immediately if end time equal to create time

        const endTime: $TSFixMe = moment(scheduledEvent.endDate);
        if (endTime <= currentTime) {
            // Revert monitor to monitoring state
            if (!data.monitorDuringEvent) {
                await MonitorService.markMonitorsAsShouldMonitor(
                    data.monitors.map((i: $TSFixMe) => {
                        return i.monitorId._id || i.monitorId;
                    })
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
            // Handle this asynchronous operation in the background
            AlertService.sendCreatedScheduledEventToSubscribers(
                scheduledEvent
            ).catch((error: Error) => {
                ErrorService.log(
                    'AlertService.sendCreatedScheduledEventToSubscribers',
                    error
                );
            });
        }

        if (!recurring) {
            // Run in the background
            RealTimeService.addScheduledEvent(scheduledEvent);
        }
        return scheduledEvent;
    }

    public async updateOneBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.deleted = false;
        }

        if (!data.monitors || data.monitors.length === 0) {
            const error: $TSFixMe = new Error(
                'You need at least one monitor to update a scheduled event'
            );

            error.code = 400;
            throw error;
        }

        if (!isArrayUnique(data.monitors)) {
            const error: $TSFixMe = new Error(
                'You cannot have multiple selection of a monitor'
            );

            error.code = 400;
            throw error;
        }

        // Reassign data.monitors with a restructured monitor data
        data.monitors = data.monitors.map((monitor: $TSFixMe) => {
            return {
                monitorId: monitor,
            };
        });

        if (!data.monitorDuringEvent) {
            await MonitorService.markMonitorsAsShouldNotMonitor(
                data.monitors.map((i: $TSFixMe) => {
                    return i.monitorId._id || i.monitorId;
                })
            );
        } else {
            await MonitorService.markMonitorsAsShouldMonitor(
                data.monitors.map((i: $TSFixMe) => {
                    return i.monitorId._id || i.monitorId;
                })
            );
        }

        if (data && data.name) {
            data.slug = getSlug(data.name);
        }
        let updatedScheduledEvent: $TSFixMe =
            await ScheduledEventModel.findOneAndUpdate(
                { _id: query._id },
                {
                    $set: data,
                },
                { new: true }
            );

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

        updatedScheduledEvent = await this.findOneBy({
            query: { _id: updatedScheduledEvent._id },
            populate,
            select,
        });

        if (!updatedScheduledEvent) {
            const error: $TSFixMe = new Error(
                'Scheduled Event not found or does not exist'
            );

            error.code = 400;
            throw error;
        }

        // Run in the background
        RealTimeService.updateScheduledEvent(updatedScheduledEvent);

        return updatedScheduledEvent;
    }

    public async updateBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.deleted = false;
        }
        let updatedData: $TSFixMe = await ScheduledEventModel.updateMany(
            query,
            {
                $set: data,
            }
        );

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

        updatedData = await this.findBy({ query, populate, select });

        return updatedData;
    }

    public async deleteBy(query: Query, userId: ObjectID): void {
        const scheduledEvent: $TSFixMe =
            await ScheduledEventModel.findOneAndUpdate(
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
                scheduledEvent.monitors.map((i: $TSFixMe) => {
                    return i.monitorId._id || i.monitorId;
                })
            );
        }

        if (!scheduledEvent) {
            const error: $TSFixMe = new Error(
                'Scheduled Event not found or does not exist'
            );

            error.code = 400;
            throw error;
        }

        // Run in the background
        RealTimeService.deleteScheduledEvent(scheduledEvent);

        return scheduledEvent;
    }

    public async findBy({
        query,
        limit,
        skip,
        populate,
        select,
        sort,
    }: FindBy): void {
        if (!skip) {
            skip = 0;
        }

        if (!limit) {
            limit = 0;
        }

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
        const scheduledEventQuery: $TSFixMe = ScheduledEventModel.find(query)
            .limit(limit.toNumber())
            .skip(skip.toNumber())
            .sort(sort)
            .lean();

        scheduledEventQuery.select(select);
        scheduledEventQuery.populate(populate);

        const scheduledEvents: $TSFixMe = await scheduledEventQuery;

        return scheduledEvents;
    }

    public async findOneBy({ query, select, populate, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const scheduledEventQuery: $TSFixMe = ScheduledEventModel.findOne(query)
            .sort(sort)
            .lean();

        scheduledEventQuery.select(select);
        scheduledEventQuery.populate(populate);

        const scheduledEvent: $TSFixMe = await scheduledEventQuery;

        if (scheduledEvent) {
            if (scheduledEvent.createdById === 'API') {
                scheduledEvent.createdById = {
                    name: 'API',
                    _id: null,
                };
            } else {
                const user: $TSFixMe = await UserModel.findOne({
                    _id: scheduledEvent.createdById,
                }).lean();

                scheduledEvent.createdById = {
                    _id: user._id,
                    name: user.name,
                };
            }
        }

        return scheduledEvent;
    }

    public async getSubProjectScheduledEvents(subProjectIds: $TSFixMe): void {
        const populateScheduledEvent: $TSFixMe = [
            { path: 'resolvedBy', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'createdById', select: 'name' },
            {
                path: 'monitors.monitorId',
                select: 'name',
                populate: { path: 'componentId', select: 'name slug' },
            },
        ];
        const selectScheduledEvent: $TSFixMe =
            'cancelled showEventOnStatusPage callScheduleOnEvent monitorDuringEvent monitorDuringEvent recurring interval alertSubscriber resolved monitors name startDate endDate description createdById projectId slug createdAt ';

        const subProjectScheduledEvents: $TSFixMe = await Promise.all(
            subProjectIds.map(async (id: $TSFixMe) => {
                const scheduledEvents: $TSFixMe = await this.findBy({
                    query: { projectId: id },
                    limit: 10,
                    skip: 0,
                    populate: populateScheduledEvent,
                    select: selectScheduledEvent,
                });
                const count: $TSFixMe = await this.countBy({ projectId: id });
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
    }

    public async getSubProjectOngoingScheduledEvents(
        subProjectIds: $TSFixMe,
        query: Query
    ): void {
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

        const subProjectOngoingScheduledEvents: $TSFixMe = await Promise.all(
            subProjectIds.map(async (id: $TSFixMe) => {
                const ongoingScheduledEvents: $TSFixMe = await this.findBy({
                    query: { projectId: id, ...query },
                    populate,
                    select,
                });
                const count: $TSFixMe = await this.countBy({
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
    }

    /**
     * @description removes a particular monitor from scheduled event
     * @description if no monitor remains after deletion, then the scheduled event is deleted
     * @param {string} monitorId the id of the monitor
     * @param {string} userId the id of the user
     */
    public async removeMonitor(monitorId: $TSFixMe, userId: ObjectID): void {
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

        const scheduledEvents: $TSFixMe = await this.findBy({
            query: { 'monitors.monitorId': monitorId },
            populate,
            select,
        });

        await Promise.all(
            scheduledEvents.map(async (event: $TSFixMe) => {
                // Remove the monitor from scheduled event monitors list
                event.monitors = event.monitors.filter((monitor: $TSFixMe) => {
                    return String(monitor.monitorId._id) !== String(monitorId);
                });

                if (event.monitors.length > 0) {
                    let updatedEvent: $TSFixMe =
                        await ScheduledEventModel.findOneAndUpdate(
                            { _id: event._id },
                            { $set: { monitors: event.monitors } },
                            { new: true }
                        );

                    updatedEvent = await this.findOneBy({
                        query: { _id: updatedEvent._id },
                        select,
                        populate,
                    });

                    RealTimeService.updateScheduledEvent(updatedEvent);
                } else {
                    // Delete the scheduled event when no monitor is remaining
                    let deletedEvent: $TSFixMe =
                        await ScheduledEventModel.findOneAndUpdate(
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
    }

    /**
     * @description resolves a particular scheduled event
     * @param {object} query query parameter to use for db manipulation
     * @param {object} data data to be used to update the schedule
     */
    public async resolveScheduledEvent(query: Query, data: $TSFixMe): void {
        data.resolved = true;
        data.resolvedAt = Date.now();
        let resolvedScheduledEvent: $TSFixMe =
            await ScheduledEventModel.findOneAndUpdate(
                query,
                { $set: data },
                { new: true }
            );
        if (
            resolvedScheduledEvent &&
            !resolvedScheduledEvent.monitorDuringEvent
        ) {
            await MonitorService.markMonitorsAsShouldMonitor(
                resolvedScheduledEvent.monitors.map((monitor: $TSFixMe) => {
                    return monitor.monitorId._id || monitor.monitorId;
                })
            );
        }

        if (resolvedScheduledEvent.recurring) {
            let newStartDate: $TSFixMe;
            let newEndDate: $TSFixMe;
            const startDate: $TSFixMe = resolvedScheduledEvent.startDate;
            const endDate: $TSFixMe = resolvedScheduledEvent.endDate;
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
            const postObj: $TSFixMe = {};

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
            const projectId: $TSFixMe = resolvedScheduledEvent.projectId;
            const monitors: $TSFixMe = resolvedScheduledEvent.monitors.map(
                (monitor: $TSFixMe) => {
                    return monitor.monitorId;
                }
            );

            postObj.monitors = monitors;
            this.create({ projectId }, postObj, true);
        }
        // Populate the necessary data
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
            'cancelled showEventOnStatusPage callScheduleOnEvent monitorDuringEvent monitorDuringEvent recurring interval alertSubscriber resolved monitors name startDate endDate description createdById projectId slug createdAt';

        resolvedScheduledEvent = await this.findOneBy({
            query: { _id: resolvedScheduledEvent._id },
            select,
            populate,
        });

        /*
         * Add note automatically
         * When a scheduled event is resolved
         */

        await ScheduledEventNoteService.create({
            content: 'This scheduled event has been resolved',
            scheduledEventId: query._id,
            createdById: data.resolvedBy,
            type: 'investigation',
            event_state: 'Resolved',
        });

        if (resolvedScheduledEvent.alertSubscriber) {
            // Handle this asynchronous operation in the background
            AlertService.sendResolvedScheduledEventToSubscribers(
                resolvedScheduledEvent
            ).catch((error: Error) => {
                ErrorService.log(
                    'AlertService.sendResolvedScheduledEventToSubscribers',
                    error
                );
            });
        }

        /*
         * Realtime update
         * Run in the background
         */
        RealTimeService.resolveScheduledEvent(resolvedScheduledEvent);

        return resolvedScheduledEvent;
    }
    /**
     * @description Create Started note for all schedule events
     */
    public async createScheduledEventStartedNote(): void {
        const currentTime: $TSFixMe = moment();

        //Fetch events that have started
        const scheduledEventList: $TSFixMe = await this.findBy({
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

        scheduledEventList.map(async (scheduledEvent: $TSFixMe) => {
            const scheduledEventId: $TSFixMe = scheduledEvent._id;

            // Set monitoring status of the monitor
            if (!scheduledEvent.monitorDuringEvent) {
                if (
                    scheduledEvent.monitors &&
                    scheduledEvent.monitors.length > 0
                ) {
                    await MonitorService.markMonitorsAsShouldNotMonitor(
                        scheduledEvent.monitors.map((i: $TSFixMe) => {
                            return i.monitorId._id || i.monitorId;
                        })
                    );
                }
            } else if (
                scheduledEvent.monitors &&
                scheduledEvent.monitors.length > 0
            ) {
                await MonitorService.markMonitorsAsShouldMonitor(
                    scheduledEvent.monitors.map((i: $TSFixMe) => {
                        return i.monitorId._id || i.monitorId;
                    })
                );
            }

            const scheduledEventNoteCount: $TSFixMe =
                await ScheduledEventNoteService.countBy({
                    scheduledEventId,
                    event_state: 'Started',
                });
            if (scheduledEventNoteCount === 0) {
                await ScheduledEventNoteService.create({
                    content: 'This scheduled event has started',
                    scheduledEventId,
                    type: 'investigation',
                    event_state: 'Started',
                });
            }
        });
    }

    public async createScheduledEventEndedNote(): void {
        const currentTime: $TSFixMe = moment();

        //Fetch events that have ended
        const scheduledEventList: $TSFixMe = await this.findBy({
            query: {
                endDate: { $lte: currentTime },
                deleted: false,
                cancelled: false,
            },
            limit: 0,
            skip: 0,
            select: '_id monitorDuringEvent monitors',
        });
        scheduledEventList.map(async (scheduledEvent: $TSFixMe) => {
            const scheduledEventId: $TSFixMe = scheduledEvent._id;

            // Revert monitor back to monitoring state
            if (scheduledEvent && !scheduledEvent.monitorDuringEvent) {
                if (
                    scheduledEvent.monitors &&
                    scheduledEvent.monitors.length > 0
                ) {
                    await MonitorService.markMonitorsAsShouldMonitor(
                        scheduledEvent.monitors.map((i: $TSFixMe) => {
                            return i.monitorId._id || i.monitorId;
                        })
                    );
                }
            }

            const scheduledEventNoteListCount: $TSFixMe =
                await ScheduledEventNoteService.countBy({
                    scheduledEventId,
                    event_state: 'Ended',
                });
            if (scheduledEventNoteListCount === 0) {
                await ScheduledEventNoteService.create({
                    content: 'This scheduled event has ended',
                    scheduledEventId,
                    type: 'investigation',
                    event_state: 'Ended',
                });
            }
        });
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
