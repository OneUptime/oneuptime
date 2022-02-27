// @ts-expect-error ts-migrate(2614) FIXME: Module '"../utils/api"' has no exported member 'po... Remove this comment to see the full error message
import { postApi } from '../utils/api';
import ErrorService from './errorService';
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../utils/config"' has no exported member ... Remove this comment to see the full error message
import { scriptBaseUrl } from '../utils/config';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'db' does not exist on type 'Global & typ... Remove this comment to see the full error message
const scriptLogCollection = global.db.collection('automationsriptlogs');
// @ts-expect-error ts-migrate(2339) FIXME: Property 'db' does not exist on type 'Global & typ... Remove this comment to see the full error message
const scriptCollection = global.db.collection('automationsripts');
import { ObjectId } from 'mongodb';
import moment from 'moment';

export default {
    createLog: async function(id: $TSFixMe, data: $TSFixMe) {
        try {
            const scriptLog = {};
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'automationScriptId' does not exist on ty... Remove this comment to see the full error message
            scriptLog.automationScriptId = id ? ObjectId(id) : null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerByUser' does not exist on type '{... Remove this comment to see the full error message
            scriptLog.triggerByUser = data.triggerByUser
                ? // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                  ObjectId(data.triggerByUser)
                : null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerByScript' does not exist on type ... Remove this comment to see the full error message
            scriptLog.triggerByScript = data.triggerByScript
                ? // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                  ObjectId(data.triggerByScript)
                : null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'triggerByIncident' does not exist on typ... Remove this comment to see the full error message
            scriptLog.triggerByIncident = data.triggerByIncident
                ? // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                  ObjectId(data.triggerByIncident)
                : null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type '{}'.
            scriptLog.status = data.status || null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'executionTime' does not exist on type '{... Remove this comment to see the full error message
            scriptLog.executionTime = data.executionTime || null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'consoleLogs' does not exist on type '{}'... Remove this comment to see the full error message
            scriptLog.consoleLogs = data.consoleLogs || null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'error' does not exist on type '{}'.
            scriptLog.error = data.error || null;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdAt' does not exist on type '{}'.
            scriptLog.createdAt = new Date(moment().format());
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleted' does not exist on type '{}'.
            scriptLog.deleted = false;

            const result = await scriptLogCollection.insertOne(scriptLog);
            const newScriptLog = await this.findOneBy({
                // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                _id: ObjectId(result.insertedId),
            });

            return newScriptLog;
        } catch (error) {
            ErrorService.log('automatedScript.createLog', error);
            throw error;
        }
    },

    updateOne: async function(query: $TSFixMe, data: $TSFixMe) {
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

    findOneBy: async function(query: $TSFixMe) {
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

    runResource: async function({
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
    }: $TSFixMe) {
        try {
            const _this = this;
            const {
                script,
                scriptType,
                successEvent,
                failureEvent,
            } = await _this.findOneBy({
                // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
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
