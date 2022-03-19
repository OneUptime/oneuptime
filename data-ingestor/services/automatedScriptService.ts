import { postApi } from '../utils/api';
import ErrorService from './errorService';

import { scriptBaseUrl } from '../utils/config';

const scriptLogCollection = global.db.collection('automationsriptlogs');

const scriptCollection = global.db.collection('automationsripts');
import { ObjectId } from 'mongodb';
import moment from 'moment';

export default {
    createLog: async function (id: $TSFixMe, data: $TSFixMe) {
        try {
            const scriptLog = {};

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

            const result = await scriptLogCollection.insertOne(scriptLog);
            const newScriptLog = await this.findOneBy({
                _id: ObjectId(result.insertedId),
            });

            return newScriptLog;
        } catch (error) {
            ErrorService.log('automatedScript.createLog', error);
            throw error;
        }
    },

    updateOne: async function (query: $TSFixMe, data: $TSFixMe) {
        try {
            if (!query) {
                query = {};
            }
            if (!query.deleted)
                query.$or = [
                    { deleted: false },
                    { deleted: { $exists: false } },
                ];

            await scriptCollection.updateOne(query, { $set: data });
            const response = await scriptCollection.findOne(query);
            return response;
        } catch (error) {
            ErrorService.log('automatedScript.updateOne', error);
            throw error;
        }
    },

    findOneBy: async function (query: $TSFixMe) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted)
                query.$or = [
                    { deleted: false },
                    { deleted: { $exists: false } },
                ];

            const response = await scriptCollection.findOne(query);
            return response;
        } catch (error) {
            ErrorService.log('automatedScript.findOneBy', error);
            throw error;
        }
    },

    runResource: async function ({
        triggeredId,
        triggeredBy,
        resources,
        stackSize = 0,
    }: $TSFixMe) {
        try {
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
        } catch (error) {
            ErrorService.log('automatedScript.runResource', error);
            throw error;
        }
    },

    runAutomatedScript: async function ({
        automatedScriptId,
        triggeredId,
        triggeredBy = 'script',
        stackSize,
    }: $TSFixMe) {
        try {
            const _this = this;
            const { script, scriptType, successEvent, failureEvent } =
                await _this.findOneBy({
                    _id: ObjectId(automatedScriptId),
                });
            let data = null;
            if (scriptType === 'JavaScript') {
                const result = await postApi(
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
                const result = await postApi(
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
                { _id: ObjectId(automatedScriptId) },
                { updatedAt: new Date(moment().format()) }
            );
            return automatedScriptLog;
        } catch (error) {
            ErrorService.log('automatedScript.runAutomatedScript', error);
            throw error;
        }
    },
};
