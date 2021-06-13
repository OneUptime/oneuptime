const ScriptModel = require('../models/automatedScripts');
const ScriptModelLog = require('../models/automationScriptsLog');
const getSlug = require('../utils/getSlug');
const ErrorService = require('./errorService');

module.exports = {
    findBy: async function(query, skip, limit) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 10;

            if (typeof skip === 'string') skip = parseInt(skip);

            if (typeof limit === 'string') limit = parseInt(limit);

            if (!query) query = {};

            query.deleted = false;

            const sortDataList = await ScriptModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);
            return sortDataList;
        } catch (error) {
            ErrorService.log('automatedScript.findBy', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;
            const count = await ScriptModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('automatedScript.countBy', error);
            throw error;
        }
    },

    countLogBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;
            const count = await ScriptModelLog.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('automatedScript.countLogBy', error);
            throw error;
        }
    },

    create: async function(data) {
        try {
            const script = new ScriptModel();
            script.name = data.name || null;
            script.slug = getSlug(data.name) || null;
            script.scriptType = data.scriptType || null;
            script.successEvent = data.successEvent || null;
            script.failureEvent = data.failureEvent || null;
            script.projectId = data.projectId || null;
            script.script = data.script || null;
            const newScript = await script.save();

            return newScript;
        } catch (error) {
            ErrorService.log('automatedScript.create', error);
            throw error;
        }
    },

    createLog: async function(id, data) {
        try {
            const scriptLog = new ScriptModelLog();
            scriptLog.automationScriptId = id || null;
            scriptLog.triggerByUser = data.triggerByUser || null;
            scriptLog.triggerByScript = data.triggerByScript || null;
            const newScriptLog = await scriptLog.save();

            return newScriptLog;
        } catch (error) {
            ErrorService.log('automatedScript.createLog', error);
            throw error;
        }
    },

    updateOne: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;
            const response = ScriptModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                {
                    new: true,
                }
            );
            return response;
        } catch (error) {
            ErrorService.log('automatedScript.updateOne', error);
            throw error;
        }
    },

    findAllLogs: async function(query, skip, limit) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 10;

            if (typeof skip === 'string') skip = parseInt(skip);

            if (typeof limit === 'string') limit = parseInt(limit);
            if (!query) {
                query = {};
            }
            query.deleted = false;
            const response = await ScriptModelLog.find(query)
                .limit(limit)
                .skip(skip)
                .populate('automationScriptId', 'name')
                .populate('triggerByUser', 'name')
                .populate('triggerByScript', 'name');
            return response;
        } catch (error) {
            ErrorService.log('automatedScript.findAllLogs', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const response = await ScriptModel.findOne(query).populate(
                'createdById',
                'name'
            );
            return response;
        } catch (error) {
            ErrorService.log('automatedScript.findOneBy', error);
            throw error;
        }
    },

    getAutomatedLogService: async function(query, skip, limit) {
        try {
            const _this = this;
            const response = await _this.findAllLogs(query, skip, limit);
            return response;
        } catch (error) {
            ErrorService.log('automatedScript.getAutomatedLogService', error);
            throw error;
        }
    },

    createScript: async function(data) {
        try {
            const _this = this;
            const response = await _this.create(data);
            return response;
        } catch (error) {
            ErrorService.log('automatedScript.createScript', error);
            throw error;
        }
    },

    deleteBy: async function(query, userId) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const response = await ScriptModel.findOneAndUpdate(
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
            return response;
        } catch (error) {
            ErrorService.log('automatedScript.findOneAndUpdate', error);
            throw error;
        }
    },

    hardDeleteBy: async function({ query }) {
        try {
            await ScriptModel.deleteMany(query);
        } catch (error) {
            ErrorService.log('callLogs.hardDeleteBy', error);
            throw error;
        }
    },
};
