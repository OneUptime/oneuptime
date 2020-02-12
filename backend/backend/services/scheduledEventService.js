var ScheduledEventModel = require('../models/scheduledEvent');
var UserModel = require('../models/user');
var ErrorService = require('../services/errorService');


module.exports = {

    create: async function ({ projectId, monitorId }, data) {
        try {
            var _this = this;
            var scheduledEvent = new ScheduledEventModel();

            scheduledEvent.projectId = projectId;
            scheduledEvent.monitorId = monitorId;
            scheduledEvent.name = data.name;
            scheduledEvent.createdById = data.createdById;
            scheduledEvent.startDate = data.startDate;
            scheduledEvent.endDate = data.endDate;
            scheduledEvent.description = data.description;

            if (data.showEventOnStatusPage) {
                scheduledEvent.showEventOnStatusPage = data.showEventOnStatusPage;
            }
            if (data.callScheduleOnEvent) {
                scheduledEvent.callScheduleOnEvent = data.callScheduleOnEvent;
            }
            if (data.monitorDuringEvent) {
                scheduledEvent.monitorDuringEvent = data.monitorDuringEvent;
            }
            if (data.alertSubscriber) {
                scheduledEvent.alertSubscriber = data.alertSubscriber;
            }
            scheduledEvent = await scheduledEvent.save();
            scheduledEvent = await _this.findOneBy({ _id: scheduledEvent._id });
            return scheduledEvent;
        } catch (error) {
            ErrorService.log('scheduledEventService.create', error);
            throw error;
        }
    },

    updateOneBy: async function (query,data) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        try {
            var updatedScheduledEvent = await ScheduledEventModel.findOneAndUpdate(query, {
                $set: data
            }, { new: true })
                .lean();
            if (updatedScheduledEvent.createdById === 'API') {
                updatedScheduledEvent.createdById = {name: 'API', _id: null};
            } else {
                var user = await UserModel.findOne({_id: updatedScheduledEvent.createdById}).lean();
                updatedScheduledEvent.createdById = {_id: user._id, name: user.name};
            }
            return updatedScheduledEvent;
        } catch (error) {
            ErrorService.log('scheduledEventService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            var updatedData = await ScheduledEventModel.updateMany(query, {
                $set: data
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('scheduledEventService.updateMany', error);
            throw error;
        }
    },

    deleteBy: async function (query, userId) {
        try {
            var scheduledEvent = await ScheduledEventModel.findOneAndUpdate(query, {
                $set: {
                    deleted: true,
                    deletedAt: Date.now(),
                    deletedById: userId
                }
            }, { new: true });
            return scheduledEvent;
        } catch (error) {
            ErrorService.log('scheduledEventService.deleteBy', error);
            throw error;
        }
    },

    findBy: async function (query, limit, skip) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof (skip) === 'string') {
                skip = parseInt(skip);
            }

            if (typeof (limit) === 'string') {
                limit = parseInt(limit);
            }

            if (!query) {
                query = {};
            }

            query.deleted = false;
            var scheduledEvents = await ScheduledEventModel.find(query)
                .limit(limit)
                .skip(skip)
                .sort({ createdAt: -1 })
                .lean();

            await Promise.all(scheduledEvents.map(async event => {
                if (event.createdById === 'API') {
                    event.createdById = {
                        name: 'API',
                        _id: null
                    };
                    return event;
                }
                else {
                    var user = await UserModel.findOne({
                        _id: event.createdById
                    })
                        .lean();
                    event.createdById = {
                        _id: user._id,
                        name: user.name
                    };
                    return event;
                }
            }));

            return scheduledEvents;
        } catch (error) {
            ErrorService.log('scheduledEventService.findBy', error);
            throw error;
        }
    },

    findOneBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            var scheduledEvent = await ScheduledEventModel.findOne(query).lean();

            if (scheduledEvent.createdById === 'API') {
                scheduledEvent.createdById = {
                    name: 'API',
                    _id: null
                };
            } else {
                var user = await UserModel.findOne({
                    _id: scheduledEvent.createdById
                }).lean();
                scheduledEvent.createdById = {
                    _id: user._id,
                    name: user.name
                };
            }

            return scheduledEvent;
        }
        catch (error) {
            ErrorService.log('scheduledEventService.findOneBy', error);
            throw error;
        }
    },

    countBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;
            var count = await ScheduledEventModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('scheduledEventService.countBy', error);
            throw error;
        }
    },

    hardDeleteBy: async function (query) {
        try {
            await ScheduledEventModel.deleteMany(query);
            return 'Event(s) removed successfully!';
        } catch (error) {
            ErrorService.log('scheduledEventService.hardDeleteBy', error);
            throw error;
        }
    },
};
