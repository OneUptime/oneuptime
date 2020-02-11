module.exports = {
    findBy: async function(query, limit, skip) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = parseInt(skip);

            if (typeof limit === 'string') limit = parseInt(limit);

            if (!query) query = {};

            var auditLogs = await AuditLogsModel.find(query)
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

    countBy: async function(query) {
        if (!query) {
            query = {};
        }

        var count = await AuditLogsModel.count(query);
        return count;
    },

    createAuditLog: async function(data) {
        try {
            var auditLogsModel = new AuditLogsModel({
                userId: data.userId,
                projectId: data.projectId,
                reqLog: data.reqLog,
                resLog: data.resLog
            });

            var auditLog = await auditLogsModel.save();
            return auditLog;
        } catch (error) {
            ErrorService.log('auditLogs.createAuditLog', error);
            throw error;
        }
    },

    getAllAuditLogs: async function(skip, limit) {
        var _this = this;
        let auditLogs = await _this.findBy({}, limit, skip);

        return auditLogs;
    },

    searchAuditLogs: async function(query, skip, limit) {
        var _this = this;
        let searchedAuditLogs = await _this.findBy(query, limit, skip);

        return searchedAuditLogs;
    }
};

var AuditLogsModel = require('../models/auditLogs');
let ErrorService = require('./errorService');
