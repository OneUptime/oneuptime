import ScriptModel from '../models/automatedScripts';
import ScriptModelLog from '../models/automationScriptsLog';
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../utils/api"' has no exported member 'po... Remove this comment to see the full error message
import { postApi } from '../utils/api';
import getSlug from '../utils/getSlug';
const scriptBaseUrl = process.env['SCRIPT_RUNNER_URL'];
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';

export default {
    findBy: async function({ query, skip, limit, select, populate }: $TSFixMe) {
        if (!skip) skip = 0;

        if (!limit) limit = 10;

        if (typeof skip === 'string') skip = parseInt(skip);

        if (typeof limit === 'string') limit = parseInt(limit);

        if (!query) query = {};

        query.deleted = false;

        let sortDataListQuery = ScriptModel.find(query)
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);

        sortDataListQuery = handleSelect(select, sortDataListQuery);
        sortDataListQuery = handlePopulate(populate, sortDataListQuery);

        const sortDataList = await sortDataListQuery;
        return sortDataList;
    },

    countBy: async function(query: $TSFixMe) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        const count = await ScriptModel.countDocuments(query);
        return count;
    },

    countLogsBy: async function(query: $TSFixMe) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        const count = await ScriptModelLog.countDocuments(query);
        return count;
    },

    create: async function(data: $TSFixMe) {
        const script = new ScriptModel();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type 'Document<a... Remove this comment to see the full error message
        script.name = data.name || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'slug' does not exist on type 'Document<a... Remove this comment to see the full error message
        script.slug = getSlug(data.name) || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'scriptType' does not exist on type 'Docu... Remove this comment to see the full error message
        script.scriptType = data.scriptType || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'successEvent' does not exist on type 'Do... Remove this comment to see the full error message
        script.successEvent = data.successEvent || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'failureEvent' does not exist on type 'Do... Remove this comment to see the full error message
        script.failureEvent = data.failureEvent || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Docum... Remove this comment to see the full error message
        script.projectId = data.projectId || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'script' does not exist on type 'Document... Remove this comment to see the full error message
        script.script = data.script || null;
        const newScript = await script.save();

        return newScript;
    },

    createLog: async function(id: $TSFixMe, data: $TSFixMe) {
        const scriptLog = new ScriptModelLog();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'automationScriptId' does not exist on ty... Remove this comment to see the full error message
        scriptLog.automationScriptId = id || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerByUser' does not exist on type 'D... Remove this comment to see the full error message
        scriptLog.triggerByUser = data.triggerByUser || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerByScript' does not exist on type ... Remove this comment to see the full error message
        scriptLog.triggerByScript = data.triggerByScript || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerByIncident' does not exist on typ... Remove this comment to see the full error message
        scriptLog.triggerByIncident = data.triggerByIncident || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type 'Document... Remove this comment to see the full error message
        scriptLog.status = data.status || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'executionTime' does not exist on type 'D... Remove this comment to see the full error message
        scriptLog.executionTime = data.executionTime || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'consoleLogs' does not exist on type 'Doc... Remove this comment to see the full error message
        scriptLog.consoleLogs = data.consoleLogs || null;
        // @ts-expect-error ts-migrate(2551) FIXME: Property 'error' does not exist on type 'Document<... Remove this comment to see the full error message
        scriptLog.error = data.error || null;
        const newScriptLog = await scriptLog.save();

        return newScriptLog;
    },

    updateOne: async function(query: $TSFixMe, data: $TSFixMe) {
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

    findAllLogs: async function(
        query: $TSFixMe,
        skip: $TSFixMe,
        limit: $TSFixMe
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
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip)
            .populate('automationScriptId', 'name')
            .populate('triggerByUser', 'name')
            .populate('triggerByIncident', 'idNumber slug')
            .populate('triggerByScript', 'name');
        return response;
    },

    findOneBy: async function({ query, select, populate }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        let responseQuery = ScriptModel.findOne(query).lean();

        responseQuery = handleSelect(select, responseQuery);
        responseQuery = handlePopulate(populate, responseQuery);

        const response = await responseQuery;
        return response;
    },

    getAutomatedLogs: async function(
        query: $TSFixMe,
        skip: $TSFixMe,
        limit: $TSFixMe
    ) {
        const _this = this;
        const response = await _this.findAllLogs(query, skip, limit);
        return response;
    },

    createScript: async function(data: $TSFixMe) {
        const _this = this;
        const response = await _this.create(data);
        return response;
    },

    runResource: async function({
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
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerByScript' does not exist on type ... Remove this comment to see the full error message
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

    runAutomatedScript: async function({
        automatedScriptId,
        triggeredId,
        triggeredBy = 'script',
        stackSize,
    }: $TSFixMe) {
        const _this = this;
        const selectScript =
            'name script scriptType slug projectId successEvent failureEvent';
        const populateScript = [{ path: 'createdById', select: 'name' }];

        const {
            script,
            scriptType,
            successEvent,
            failureEvent,
        } = await _this.findOneBy({
            query: { _id: automatedScriptId },
            select: selectScript,
            populate: populateScript,
        });
        let data = null;
        if (scriptType === 'JavaScript') {
            const result = await postApi(`${scriptBaseUrl}/script/js`, {
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
            const result = await postApi(`${scriptBaseUrl}/script/bash`, {
                script,
            });
            data = {
                success: result.success,
                errors: result.errors,
                status: result.status,
                executionTime: result.executionTime,
                consoleLogs: result.consoleLogs,
            };
        }
        triggeredBy === 'user'
            ? // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
              (data.triggerByUser = triggeredId)
            : triggeredBy === 'script'
            ? // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
              (data.triggerByScript = triggeredId)
            : triggeredBy === 'incident'
            ? // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
              (data.triggerByIncident = triggeredId)
            : null;
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
        if (data.success && successEvent.length > 0) {
            await _this.runResource({
                triggeredId: automatedScriptId,
                resources: successEvent,
                stackSize,
            });
        }
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
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

    removeScriptFromEvent: async function({ projectId, id }: $TSFixMe) {
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

    deleteBy: async function(query: $TSFixMe, userId: $TSFixMe) {
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

    hardDeleteBy: async function({ query }: $TSFixMe) {
        await ScriptModel.deleteMany(query);
    },
};
