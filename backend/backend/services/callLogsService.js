module.exports = {
    findBy: async function({ query, limit, skip, sort, select, populate }) {
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
            // const items = await CallLogsModel.find(query)
            //     .lean()
            //     .limit(limit)
            //     .skip(skip)
            //     .sort(sort)
            //     .populate('projectId', 'name');

            let itemQuery = CallLogsModel.find(query)
                .lean()
                .limit(limit)
                .skip(skip)
                .sort(sort);
            itemQuery = handleSelect(select, itemQuery);
            itemQuery = handlePopulate(populate, itemQuery);

            const items = await itemQuery;
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
        try {
            const _this = this;
            const query = {
                to: { $regex: new RegExp(filter), $options: 'i' },
            };

            const populate = [{ path: 'projectId', select: 'name' }];
            const select = 'from to projectId content status error';
            const [searchedCallLogs, totalSearchCount] = await Promise.all([
                _this.findBy({ query, skip, limit, select, populate }),
                _this.countBy({ query }),
            ]);

            return { searchedCallLogs, totalSearchCount };
        } catch (error) {
            ErrorService.log('callLogsService.search', error);
            throw error;
        }
    },
};

const CallLogsModel = require('../models/callLogs');
const ErrorService = require('./errorService');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');
