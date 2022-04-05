import ScriptModel from '../models/automatedScripts';
import ScriptModelLog from '../models/automationScriptsLog';
import PositiveNumber from 'common/types/PositiveNumber';
import BackendAPI from '../utils/api';
import getSlug from '../utils/getSlug';
const scriptBaseUrl = process.env['SCRIPT_RUNNER_URL'];

import FindOneBy from '../types/db/FindOneBy';
import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';

export default {
    findBy: async function ({
        query,
        limit,
        skip,
        populate,
        select,
        sort,
    }: FindBy) {
        if (!skip) skip = 0;

        if (!limit) limit = 10;

        if (typeof skip === 'string') skip = parseInt(skip);

        if (typeof limit === 'string') limit = parseInt(limit);

        if (!query) query = {};

        query.deleted = false;

        const sortDataListQuery = ScriptModel.find(query)
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        sortDataListQuery.select(select);
        sortDataListQuery.populate(populate);

        const sortDataList = await sortDataListQuery;
        return sortDataList;
    },

    countBy: async function (query: Query) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        const count = await ScriptModel.countDocuments(query);
        return count;
    },

    countLogsBy: async function (query: Query) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        const count = await ScriptModelLog.countDocuments(query);
        return count;
    },

    create: async function (data: $TSFixMe) {
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
    },

    createLog: async function (id: $TSFixMe, data: $TSFixMe) {
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
    },

    updateOne: async function (query: Query, data: $TSFixMe) {
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
    },

    findAllLogs: async function (
        query: Query,
        skip: PositiveNumber,
        limit: PositiveNumber
    ) {
        if (!skip) skip = 0;

        if (!limit) limit = 10;

        if (typeof skip === 'string') skip = parseInt(skip);

        if (typeof limit === 'string') limit = parseInt(limit);
        if (!query) {
            query = {};
        }
        query.deleted = false;
        const response = await ScriptModelLog.find(query)
            .limit(limit.toNumber())
            .skip(skip.toNumber())
            .populate('automationScriptId', 'name')
            .populate('triggerByUser', 'name')
            .populate('triggerByIncident', 'idNumber slug')
            .populate('triggerByScript', 'name');
        return response;
    },

    findOneBy: async function ({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const responseQuery = ScriptModel.findOne(query).sort(sort).lean();

        responseQuery.select(select);
        responseQuery.populate(populate);

        const response = await responseQuery;
        return response;
    },

    getAutomatedLogs: async function (
        query: Query,
        skip: PositiveNumber,
        limit: PositiveNumber
    ) {
        const _this = this;
        const response = await _this.findAllLogs(query, skip, limit);
        return response;
    },

    createScript: async function (data: $TSFixMe) {
        const _this = this;
        const response = await _this.create(data);
        return response;
    },

    runResource: async function ({
        triggeredId,
        triggeredBy,
        resources,
        stackSize = 0,
    }: $TSFixMe) {
        const _this = this;
        if (stackSize === 3) {
            const resource = resources[0];
            if (resource) {
                let type;
                if (resource.automatedScript) {
                    type = 'automatedScript';
                } else if (resource.callSchedule) {
                    type = 'callSchedule';
                }
                const data = {
                    status: 'failed',
                    success: false,
                    executionTime: 1,
                    error: 'stackoverflow',
                    consoleLogs: ['Out of stack'],
                };
                switch (type) {
                    case 'automatedScript':
                        data.triggerByScript = triggeredId;
                        break;
                    default:
                        return null;
                }

                await _this.createLog(resource.automatedScript, data);
            }
        }

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
    },

    runAutomatedScript: async function ({
        automatedScriptId,
        triggeredId,
        triggeredBy = 'script',
        stackSize,
    }: $TSFixMe) {
        const _this = this;
        const selectScript =
            'name script scriptType slug projectId successEvent failureEvent';
        const populateScript = [{ path: 'createdById', select: 'name' }];

        const { script, scriptType, successEvent, failureEvent } =
            await _this.findOneBy({
                query: { _id: automatedScriptId },
                select: selectScript,
                populate: populateScript,
            });
        let data = null;
        if (scriptType === 'JavaScript') {
            const result = await BackendAPI.post(`${scriptBaseUrl}/script/js`, {
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
        } else if (scriptType === 'Bash') {
            const result = await BackendAPI.post(
                `${scriptBaseUrl}/script/bash`,
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
    },

    removeScriptFromEvent: async function ({ projectId, id }: $TSFixMe) {
        const _this = this;
        const scripts = await ScriptModel.find({ projectId }).lean();
        await Promise.all(
            scripts.map(async (script: $TSFixMe) => {
                const successEvent = script.successEvent.filter(
                    (script: $TSFixMe) =>
                        String(script.automatedScript) !== String(id)
                );
                const failureEvent = script.failureEvent.filter(
                    (script: $TSFixMe) =>
                        String(script.automatedScript) !== String(id)
                );
                return await _this.updateOne(
                    { _id: script._id },
                    { successEvent, failureEvent }
                );
            })
        );
    },

    deleteBy: async function (query: Query, userId: string) {
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
    },

    hardDeleteBy: async function ({ query }: $TSFixMe) {
        await ScriptModel.deleteMany(query);
    },
};
