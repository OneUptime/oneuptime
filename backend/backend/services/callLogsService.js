module.exports = {
    findBy: async function(query, limit, skip, sort) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = parseInt(skip);

            if (typeof limit === 'string') limit = parseInt(limit);

            if (!query) {
                query = {};
            }

            if (!sort) {
                sort = { createdAt: 'desc' };
            }

            if (!query.deleted) query.deleted = false;
            const items = await CallLogsModel.find(query)
                .limit(limit)
                .skip(skip)
                .sort(sort)
                .populate('projectId', 'name');
            return items;
        } catch (error) {
            ErrorService.log('callLogsService.findBy', error);
            throw error;
        }
    },

    create: async function(from, to, projectId, content, status, error) {
        try {
            let item = new CallLogsModel();

            item.from = from;
            item.to = to;
            item.projectId = projectId;
            item.content = content;
            item.status = status;
            item.error = error;
            item = await item.save();

            return item;
        } catch (error) {
            ErrorService.log('callLogsService.create', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const count = await CallLogsModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('callLogsService.countBy', error);
            throw error;
        }
    },

    deleteBy: async function(query, userId) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const items = await CallLogsModel.findOneAndUpdate(query, {
                $set: {
                    deleted: true,
                    deletedAt: Date.now(),
                    deletedById: userId,
                },
            });
            return items;
        } catch (error) {
            ErrorService.log('callLogsService.findOneAndUpdate', error);
            throw error;
        }
    },

    hardDeleteBy: async function({ query }) {
        try {
            await CallLogsModel.deleteMany(query);
        } catch (error) {
            ErrorService.log('callLogs.hardDeleteBy', error);
            throw error;
        }
    },

    search: async function({ filter, skip, limit }) {
        const _this = this;
        const query = {
            to: { $regex: new RegExp(filter), $options: 'i' },
        };

        const searchedCallLogs = await _this.findBy({ query, skip, limit });
        const totalSearchCount = await _this.countBy({ query });

        return { searchedCallLogs, totalSearchCount };
    },
};

const CallLogsModel = require('../models/callLogs');
const ErrorService = require('./errorService');
