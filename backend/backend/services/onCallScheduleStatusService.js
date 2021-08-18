module.exports = {
    findBy: async function({ query, skip, limit, sort, populate, select }) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 10;

            if (!sort) sort = -1;

            if (typeof skip === 'string') {
                skip = parseInt(skip);
            }

            if (typeof limit === 'string') {
                limit = parseInt(limit);
            }

            if (typeof sort === 'string') {
                sort = parseInt(sort);
            }

            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let itemsQuery = OnCallScheduleStatusModel.find(query)
                .lean()
                .limit(limit)
                .skip(skip);

            itemsQuery = handleSelect(select, itemsQuery);
            itemsQuery = handlePopulate(populate, itemsQuery);

            const items = await itemsQuery;

            return items;
        } catch (error) {
            ErrorService.log('OnCallScheduleStatusService.findBy`  ', error);
            throw error;
        }
    },

    create: async function({
        project,
        incident,
        activeEscalation,
        schedule,
        escalations,
        incidentAcknowledged,
    }) {
        try {
            let item = new OnCallScheduleStatusModel();

            item.project = project;
            item.activeEscalation = activeEscalation;
            item.schedule = schedule;
            item.incidentAcknowledged = incidentAcknowledged;
            item.incident = incident;
            item.escalations = escalations;

            item = await item.save();
            return item;
        } catch (error) {
            ErrorService.log('OnCallScheduleStatusService.create', error);
            throw error;
        }
    },

    countBy: async function({ query }) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const count = await OnCallScheduleStatusModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('OnCallScheduleStatusService.countBy', error);
            throw error;
        }
    },

    updateOneBy: async function({ query, data }) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const item = await OnCallScheduleStatusModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                {
                    new: true,
                }
            );
            return item;
        } catch (error) {
            ErrorService.log('OnCallScheduleStatusService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function({ query, data }) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            await OnCallScheduleStatusModel.updateMany(query, {
                $set: data,
            });

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
            const items = await this.findBy({
                query,
                select: selectOnCallScheduleStatus,
                populate: populateOnCallScheduleStatus,
            });
            return items;
        } catch (error) {
            ErrorService.log('OnCallScheduleStatusService.updateMany', error);
            throw error;
        }
    },

    deleteBy: async function({ query, userId }) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const items = await OnCallScheduleStatusModel.findOneAndUpdate(
                query,
                {
                    $set: {
                        deleted: true,
                        deletedAt: Date.now(),
                        deletedById: userId,
                    },
                },
                {
                    new: true,
                }
            );
            return items;
        } catch (error) {
            ErrorService.log('OnCallScheduleStatusService.deleteBy', error);
            throw error;
        }
    },

    hardDeleteBy: async function({ query }) {
        try {
            await OnCallScheduleStatusModel.deleteMany(query);
        } catch (error) {
            ErrorService.log('OnCallScheduleStatusService.hardDeleteBy', error);
            throw error;
        }
    },
};

const OnCallScheduleStatusModel = require('../models/onCallScheduleStatus');
const ErrorService = require('./errorService');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');
