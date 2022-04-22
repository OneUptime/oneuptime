import BackendAPI from '../Utils/api';
import Query from 'CommonServer/types/db/Query';
import { scriptBaseUrl } from '../Config';

const scriptLogCollection: $TSFixMe = global.db.collection(
    'automationsriptlogs'
);

const scriptCollection: $TSFixMe = global.db.collection('automationsripts');
import { ObjectId } from 'mongodb';
import moment from 'moment';

export default {
    createLog: async function (id: $TSFixMe, data: $TSFixMe): void {
        const scriptLog: $TSFixMe = {};

        scriptLog.automationScriptId = id ? ObjectId(id) : null;

        scriptLog.triggerByUser = data.triggerByUser
            ? ObjectId(data.triggerByUser)
            : null;

        scriptLog.triggerByScript = data.triggerByScript
            ? ObjectId(data.triggerByScript)
            : null;

        scriptLog.triggerByIncident = data.triggerByIncident
            ? ObjectId(data.triggerByIncident)
            : null;

        scriptLog.status = data.status || null;

        scriptLog.executionTime = data.executionTime || null;

        scriptLog.consoleLogs = data.consoleLogs || null;

        scriptLog.error = data.error || null;

        scriptLog.createdAt = new Date(moment().format());

        scriptLog.deleted = false;

        const result: $TSFixMe = await scriptLogCollection.insertOne(scriptLog);
        const newScriptLog: $TSFixMe = await this.findOneBy({
            _id: ObjectId(result.insertedId),
        });

        return newScriptLog;
    },

    updateOne: async function (query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }
        if (!query.deleted) {
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];
        }

        await scriptCollection.updateOne(query, { $set: data });
        const response: $TSFixMe = await scriptCollection.findOne(query);
        return response;
    },

    findOneBy: async function (query: Query): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];
        }

        const response: $TSFixMe = await scriptCollection.findOne(query);
        return response;
    },

    runResource: async function ({
        triggeredId,
        triggeredBy,
        resources,
        stackSize = 0,
    }: $TSFixMe): void {
        if (stackSize === 3) {
            const resource: $TSFixMe = resources[0];
            if (resource) {
                let type: $TSFixMe;
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
        const events: $TSFixMe = Array.isArray(resources)
            ? resources
            : [resources]; // Object property => {callSchedule?, automatedScript?}
        const eventPromises: $TSFixMe = events.map((event: $TSFixMe) => {
            let resourceType: $TSFixMe;
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
    },

    runAutomatedScript: async function ({
        automatedScriptId,
        triggeredId,
        triggeredBy = 'script',
        stackSize,
    }: $TSFixMe): void {
        const { script, scriptType, successEvent, failureEvent }: $TSFixMe =
            await this.findOneBy({
                _id: ObjectId(automatedScriptId),
            });
        let data: $TSFixMe = null;
        if (scriptType === 'JavaScript') {
            const result: $TSFixMe = await BackendAPI.post(
                `${scriptBaseUrl}/script/js`,
                {
                    script,
                },
                true
            );
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
                },
                true
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
            { _id: ObjectId(automatedScriptId) },
            { updatedAt: new Date(moment().format()) }
        );
        return automatedScriptLog;
    },
};
