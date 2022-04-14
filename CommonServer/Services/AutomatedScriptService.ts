import ScriptModel from '../Models/automatedScripts';
import ObjectID from 'Common/Types/ObjectID';
import ScriptModelLog from '../Models/automationScriptsLog';
import PositiveNumber from 'Common/Types/PositiveNumber';
import BackendAPI from '../Utils/api';
import getSlug from '../Utils/getSlug';
const scriptBaseUrl: $TSFixMe = process.env['SCRIPT_RUNNER_URL'];

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';

export default class Service {
    async findBy({ query, limit, skip, populate, select, sort }: FindBy): void {
        if (!skip) {
            skip = 0;
        }

        if (!limit) {
            limit = 10;
        }

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }

        if (!query) {
            query = {};
        }

        query['deleted'] = false;

        const sortDataListQuery: $TSFixMe = ScriptModel.find(query)
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        sortDataListQuery.select(select);
        sortDataListQuery.populate(populate);

        const sortDataList: $TSFixMe = await sortDataListQuery;
        return sortDataList;
    }

    async countBy(query: Query): void {
        if (!query) {
            query = {};
        }
        query['deleted'] = false;
        const count: $TSFixMe = await ScriptModel.countDocuments(query);
        return count;
    }

    async countLogsBy(query: Query): void {
        if (!query) {
            query = {};
        }
        query['deleted'] = false;
        const count: $TSFixMe = await ScriptModelLog.countDocuments(query);
        return count;
    }

    async create(data: $TSFixMe): void {
        const script: $TSFixMe = new ScriptModel();

        script.name = data.name || null;

        script.slug = getSlug(data.name) || null;

        script.scriptType = data.scriptType || null;

        script.successEvent = data.successEvent || null;

        script.failureEvent = data.failureEvent || null;

        script.projectId = data.projectId || null;

        script.script = data.script || null;
        const newScript: $TSFixMe = await script.save();

        return newScript;
    }

    async createLog(id: $TSFixMe, data: $TSFixMe): void {
        const scriptLog: $TSFixMe = new ScriptModelLog();

        scriptLog.automationScriptId = id || null;

        scriptLog.triggerByUser = data.triggerByUser || null;

        scriptLog.triggerByScript = data.triggerByScript || null;

        scriptLog.triggerByIncident = data.triggerByIncident || null;

        scriptLog.status = data.status || null;

        scriptLog.executionTime = data.executionTime || null;

        scriptLog.consoleLogs = data.consoleLogs || null;

        scriptLog.error = data.error || null;
        const newScriptLog: $TSFixMe = await scriptLog.save();

        return newScriptLog;
    }

    async updateOne(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }
        query['deleted'] = false;
        const response: $TSFixMe = ScriptModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            {
                new: true,
            }
        );
        return response;
    }

    async findAllLogs(
        query: Query,
        skip: PositiveNumber,
        limit: PositiveNumber
    ): void {
        if (!skip) {
            skip = 0;
        }

        if (!limit) {
            limit = 10;
        }

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }
        if (!query) {
            query = {};
        }
        query['deleted'] = false;
        const response: $TSFixMe = await ScriptModelLog.find(query)
            .limit(limit.toNumber())
            .skip(skip.toNumber())
            .populate('automationScriptId', 'name')
            .populate('triggerByUser', 'name')
            .populate('triggerByIncident', 'idNumber slug')
            .populate('triggerByScript', 'name');
        return response;
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }

        query['deleted'] = false;
        const responseQuery: $TSFixMe = ScriptModel.findOne(query).sort(sort).lean();

        responseQuery.select(select);
        responseQuery.populate(populate);

        const response: $TSFixMe = await responseQuery;
        return response;
    }

    async getAutomatedLogs(
        query: Query,
        skip: PositiveNumber,
        limit: PositiveNumber
    ): void {
        const response: $TSFixMe = await this.findAllLogs(query, skip, limit);
        return response;
    }

    async createScript(data: $TSFixMe): void {
        const response: $TSFixMe = await this.create(data);
        return response;
    }

    async runResource({
        triggeredId,
        triggeredBy,
        resources,
        stackSize = 0,
    }: $TSFixMe): void {
        if (stackSize === 3) {
            const resource: $TSFixMe = resources[0];
            if (resource) {
                let type;
                if (resource.automatedScript) {
                    type = 'automatedScript';
                } else if (resource.callSchedule) {
                    type = 'callSchedule';
                }
                const data: $TSFixMe = {
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

                await this.createLog(resource.automatedScript, data);
            }
        }

        if (stackSize > 2) {
            return;
        }
        const events: $TSFixMe = Array.isArray(resources) ? resources : [resources]; // object property => {callSchedule?, automatedScript?}
        const eventPromises: $TSFixMe = events.map(event: $TSFixMe => {
            let resourceType;
            if (event.automatedScript) {
                resourceType = 'automatedScript';
            } else if (event.callSchedule) {
                resourceType = 'callSchedule';
            }
            const automatedScriptId: $TSFixMe = event.automatedScript;
            switch (resourceType) {
                case 'automatedScript':
                    return this.runAutomatedScript({
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
    }

    async runAutomatedScript({
        automatedScriptId,
        triggeredId,
        triggeredBy = 'script',
        stackSize,
    }: $TSFixMe): void {
        const selectScript: $TSFixMe =
            'name script scriptType slug projectId successEvent failureEvent';
        const populateScript: $TSFixMe = [{ path: 'createdById', select: 'name' }];

        const { script, scriptType, successEvent, failureEvent }: $TSFixMe =
            await this.findOneBy({
                query: { _id: automatedScriptId },
                select: selectScript,
                populate: populateScript,
            });
        let data: $TSFixMe = null;
        if (scriptType === 'JavaScript') {
            const result: $TSFixMe = await BackendAPI.post(`${scriptBaseUrl}/script/js`, {
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
            const result: $TSFixMe = await BackendAPI.post(
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
            await this.runResource({
                triggeredId: automatedScriptId,
                resources: successEvent,
                stackSize,
            });
        }

        if (!data.success && failureEvent.length > 0) {
            await this.runResource({
                triggeredId: automatedScriptId,
                resources: failureEvent,
                stackSize,
            });
        }
        const automatedScriptLog: $TSFixMe = await this.createLog(
            automatedScriptId,
            data
        );
        await this.updateOne(
            { _id: automatedScriptId },
            { updatedAt: new Date() }
        );
        return automatedScriptLog;
    }

    async removeScriptFromEvent({ projectId, id }: $TSFixMe): void {
        const scripts: $TSFixMe = await ScriptModel.find({ projectId }).lean();
        await Promise.all(
            scripts.map(async (script: $TSFixMe) => {
                const successEvent: $TSFixMe = script.successEvent.filter(
                    (script: $TSFixMe) =>
                        String(script.automatedScript) !== String(id)
                );
                const failureEvent: $TSFixMe = script.failureEvent.filter(
                    (script: $TSFixMe) =>
                        String(script.automatedScript) !== String(id)
                );
                return await this.updateOne(
                    { _id: script._id },
                    { successEvent, failureEvent }
                );
            })
        );
    }

    async deleteBy(query: Query, userId: ObjectID): void {
        if (!query) {
            query = {};
        }

        query['deleted'] = false;
        const response: $TSFixMe = await ScriptModel.findOneAndUpdate(
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
    }

    async hardDeleteBy({ query }: $TSFixMe): void {
        await ScriptModel.deleteMany(query);
    }
}
