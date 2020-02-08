module.exports = {
    findBy: async function ({ query, skip, limit, sort }) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 10;

            if (!sort) sort = -1;

            if (typeof (skip) === 'string') {
                skip = parseInt(skip);
            }

            if (typeof (limit) === 'string') {
                limit = parseInt(limit);
            }

            if (typeof (sort) === 'string') {
                sort = parseInt(sort);
            }

            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            var items = await OnCallScheduleStatusModel.find(query)
                .limit(limit)
                .skip(skip)
                .populate('projectId')
                .populate('incidentId')
                .populate('scheduleId')
                .populate('activeEscalationId');

            return items;
        } catch (error) {
            ErrorService.log('OnCallScheduleStatusService.findBy`  ', error);
            throw error;
        }
    },


    create: async function ({ projectId, incidentId, activeEscalationId, scheduleId, incidentAcknowledged }) {
        try {
            var item = new OnCallScheduleStatusModel();

            item.projectId = projectId;
            item.activeEscalationId = activeEscalationId;
            item.scheduleId = scheduleId;
            item.incidentAcknowledged = incidentAcknowledged;
            item.incidentId = incidentId;

            var item = await item.save();
            return item;
        } catch (error) {
            ErrorService.log('OnCallScheduleStatusService.create', error);
            throw error;
        }
    },

    countBy: async function ({ query }) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            var count = await OnCallScheduleStatusModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('OnCallScheduleStatusService.countBy', error);
            throw error;
        }

    },

    updateOneBy: async function ({ query, data }) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            var item = await OnCallScheduleStatusModel.findOneAndUpdate(query,
                {
                    $set: data
                },
                {
                    new: true
                });
            return item;
        } catch (error) {
            ErrorService.log('OnCallScheduleStatusService.updateOneBy', error);
            throw error;
        }

    },

    updateBy: async function ({ query, data }) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            await OnCallScheduleStatusModel.updateMany(query, {
                $set: data
            });
            var items = await this.findBy(query);
            return items;
        } catch (error) {
            ErrorService.log('OnCallScheduleStatusService.updateMany', error);
            throw error;
        }
    },

    deleteBy: async function ({ query, userId }) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            var items = await OnCallScheduleStatusModel.findOneAndUpdate(query, {
                $set: {
                    deleted: true,
                    deletedAt: Date.now(),
                    deletedById: userId
                }
            }, {
                new: true
            });
            return items;
        } catch (error) {
            ErrorService.log('OnCallScheduleStatusService.deleteBy', error);
            throw error;
        }
    },

    hardDeleteBy: async function ({query}) {
        try {
            await OnCallScheduleStatusModel.deleteMany(query);
        } catch (error) {
            ErrorService.log('OnCallScheduleStatusService.hardDeleteBy', error);
            throw error;
        }
    },
};

let OnCallScheduleStatusModel = require('../models/onCallScheduleStatus');
let ErrorService = require('./errorService');