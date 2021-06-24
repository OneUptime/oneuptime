const ScriptModel = require('../models/automatedScripts');
const ScriptModelLog = require('../models/automationScriptsLog');
const { postApi } = require('../utils/api');
const getSlug = require('../utils/getSlug');
const ErrorService = require('./errorService');
const scriptBaseUrl = process.env['SCRIPT_RUNNER_URL'];

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

    countLogsBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;
            const count = await ScriptModelLog.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('automatedScript.countLogsBy', error);
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
            scriptLog.triggerByIncident = data.triggerByIncident || null;
            scriptLog.status = data.status || null;
            scriptLog.executionTime = data.executionTime || null;
            scriptLog.consoleLogs = data.consoleLogs || null;
            scriptLog.error = data.error || null;
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
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('automationScriptId', 'name')
                .populate('triggerByUser', 'name')
                .populate('triggerByIncident', 'idNumber')
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
            const response = await ScriptModel.findOne(query)
                .lean()
                .populate('createdById', 'name');
            return response;
        } catch (error) {
            ErrorService.log('automatedScript.findOneBy', error);
            throw error;
        }
    },

    getAutomatedLogs: async function(query, skip, limit) {
        try {
            const _this = this;
            const response = await _this.findAllLogs(query, skip, limit);
            return response;
        } catch (error) {
            ErrorService.log('automatedScript.getAutomatedLogs', error);
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

    runResource: async function({
        triggeredId,
        triggeredBy,
        resources,
        stackSize = 0,
    }) {
        try {
            const _this = this;
            if (stackSize > 2) {
                return;
            }
            const events = Array.isArray(resources) ? resources : [resources]; // object property => {callSchedule?, automatedScript?}
            const eventPromises = events.map(event => {
                let resourceType;
                if (event.automatedScript) {
                    resourceType = 'automatedScript';
                } else if (event.callSchedule) {
                    resourceType = 'callSchedule';
                }
                const automatedScriptId = event.automatedScript;
                switch (resourceType) {
                    case 'automatedScript':
                        return _this.runAutomatedScript({
                            automatedScriptId,
                            triggeredId,
                            triggeredBy,
                            stackSize: stackSize + 1,
                        });
                    default:
                        return null;
                }
            });

            return Promise.all(eventPromises);
        } catch (error) {
            ErrorService.log('automatedScript.runResource', error);
            throw error;
        }
    },

    runAutomatedScript: async function({
        automatedScriptId,
        triggeredId,
        triggeredBy = 'script',
        stackSize,
    }) {
        try {
            const _this = this;
            const {
                script,
                scriptType,
                successEvent,
                failureEvent,
            } = await _this.findOneBy({
                _id: automatedScriptId,
            });
            let data = null;
            if (scriptType === 'javascript') {
                const result = await postApi(`${scriptBaseUrl}/api/script/js`, {
                    script,
                });
                data = {
                    success: result.success,
                    message: result.message,
                    errors: result.success
                        ? undefined
                        : result.message + ': ' + result.errors,
                    status: result.status,
                    executionTime: result.executionTime,
                    consoleLogs: result.consoleLogs,
                };
            } else if (scriptType === 'bash') {
                const result = await postApi(
                    `${scriptBaseUrl}/api/script/bash`,
                    {
                        script,
                    }
                );
                data = {
                    success: result.success,
                    errors: result.errors,
                    status: result.status,
                    executionTime: result.executionTime,
                    consoleLogs: result.consoleLogs,
                };
            }
            triggeredBy === 'user'
                ? (data.triggerByUser = triggeredId)
                : triggeredBy === 'script'
                ? (data.triggerByScript = triggeredId)
                : triggeredBy === 'incident'
                ? (data.triggerByIncident = triggeredId)
                : null;
            if (data.success && successEvent.length > 0) {
                await _this.runResource({
                    triggeredId: automatedScriptId,
                    resources: successEvent,
                    stackSize,
                });
            }
            if (!data.success && failureEvent.length > 0) {
                await _this.runResource({
                    triggeredId: automatedScriptId,
                    resources: failureEvent,
                    stackSize,
                });
            }
            const automatedScriptLog = await _this.createLog(
                automatedScriptId,
                data
            );
            await _this.updateOne(
                { _id: automatedScriptId },
                { updatedAt: new Date() }
            );
            return automatedScriptLog;
        } catch (error) {
            ErrorService.log('automatedScript.runAutomatedScript', error);
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
