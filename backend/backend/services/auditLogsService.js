module.exports = {
    findBy: async function({ query, skip, limit }) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = parseInt(skip);

            if (typeof limit === 'string') limit = parseInt(limit);

            if (!query) query = {};

            const auditLogs = await AuditLogsModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('userId', 'name')
                .populate('projectId', 'name');
            return auditLogs;
        } catch (error) {
            ErrorService.log('auditLogs.findBy', error);
            throw error;
        }
    },

    countBy: async function({ query }) {
        if (!query) {
            query = {};
        }

        const count = await AuditLogsModel.count(query);
        return count;
    },

    create: async function(data) {
        try {
            const auditLogsModel = new AuditLogsModel({
                userId: data.userId,
                projectId: data.projectId,
                request: data.request,
                response: data.response,
            });

            const auditLog = await auditLogsModel.save();
            return auditLog;
        } catch (error) {
            ErrorService.log('auditLogs.create', error);
            throw error;
        }
    },

    search: async function({ filter, skip, limit }) {
        const _this = this;
        const query = {
            'request.apiSection': { $regex: new RegExp(filter), $options: 'i' },
        };

        const searchedAuditLogs = await _this.findBy({ query, skip, limit });
        const totalSearchCount = await _this.countBy({ query });

        return { searchedAuditLogs, totalSearchCount };
    },

    hardDeleteBy: async function({ query }) {
        try {
            await AuditLogsModel.deleteMany(query);
            return 'Audit Log(s) Removed Successfully!';
        } catch (error) {
            ErrorService.log('auditLogs.hardDeleteBy', error);
            throw error;
        }
    },
};

const AuditLogsModel = require('../models/auditLogs');
const ErrorService = require('./errorService');
