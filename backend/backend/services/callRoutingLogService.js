module.exports = {
    findBy: async function({ query, skip, limit, select, populate }) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = parseInt(skip);

            if (typeof limit === 'string') limit = parseInt(limit);

            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            let callRoutingLogQuery = CallRoutingLogModel.find(query)
                .lean()
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);
            callRoutingLogQuery = handleSelect(select, callRoutingLogQuery);
            callRoutingLogQuery = handlePopulate(populate, callRoutingLogQuery);

            const callRoutingLog = await callRoutingLogQuery;
            return callRoutingLog;
        } catch (error) {
            ErrorService.log('callRoutingLogService.findBy', error);
            throw error;
        }
    },

    create: async function(data) {
        try {
            const callRoutingLogModel = new CallRoutingLogModel();
            callRoutingLogModel.callRoutingId = data.callRoutingId;
            callRoutingLogModel.calledFrom = data.calledFrom;
            callRoutingLogModel.calledTo = data.calledTo;
            callRoutingLogModel.callSid = data.callSid;
            callRoutingLogModel.dialTo = data.dialTo;

            const logs = await callRoutingLogModel.save();
            return logs;
        } catch (error) {
            ErrorService.log('callRoutingLogService.create', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const count = await CallRoutingLogModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('callRoutingLogService.countBy', error);
            throw error;
        }
    },

    deleteBy: async function(query, userId) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const logs = await CallRoutingLogModel.findOneAndUpdate(
                query,
                {
                    $set: {
                        deleted: true,
                        deletedById: userId,
                        deletedAt: Date.now(),
                    },
                },
                {
                    new: true,
                }
            );
            return logs;
        } catch (error) {
            ErrorService.log('callRoutingService.deleteBy', error);
            throw error;
        }
    },

    findOneBy: async function({ query, select, populate }) {
        try {
            if (!query) {
                query = {};
            }
            if (!query.deleted) query.deleted = false;

            let logQuery = CallRoutingLogModel.findOne(query)
                .lean()
                .sort([['createdAt', -1]]);
            logQuery = handleSelect(select, logQuery);
            logQuery = handlePopulate(populate, logQuery);

            const log = await logQuery;
            return log;
        } catch (error) {
            ErrorService.log('callRoutingLogService.findOneBy', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;

        try {
            const updatedCallRoutingLog = await CallRoutingLogModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                {
                    new: true,
                }
            );
            return updatedCallRoutingLog;
        } catch (error) {
            ErrorService.log('callRoutingLogService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await CallRoutingLogModel.updateMany(query, {
                $set: data,
            });
            const select =
                'callRoutingId callSid price calledFrom calledTo duration dialTo';
            updatedData = await this.findBy({ query, select });
            return updatedData;
        } catch (error) {
            ErrorService.log('callRoutingLogService.updateMany', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query) {
        try {
            await CallRoutingLogModel.deleteMany(query);
            return 'Call routing Log(s) Removed Successfully!';
        } catch (error) {
            ErrorService.log('callRoutingLogService.hardDeleteBy', error);
            throw error;
        }
    },
};

const CallRoutingLogModel = require('../models/callRoutingLog');
const ErrorService = require('./errorService');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');
