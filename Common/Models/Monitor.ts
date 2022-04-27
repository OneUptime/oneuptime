import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
const criteriaItem: Schema = new Schema({
    criteriaType: string, 
    filter: 
}

// A schema definition for a criterion event, i.e up, down, or degraded
const criteriaSchema: Schema = new Schema({
    condition: string, 
    criteria: []
}

// A schema definition for a criterion event, i.e up, down, or degraded
const criterionEventSchema: Schema = new Schema({
    scheduleIds: [String],
    createAlert: boolean,
    autoAcknowledge: boolean,
    autoResolve: boolean,
    title: { type: string, default: '' },
    description: { type: string, default: '' },
    default: boolean,
    name: string,
    criteria: {
        condition: string,
        criteria: [Schema.Types.Mixed],
    },
    scripts: [
        {
            scriptId: {
                type: Schema.Types.ObjectId,
                ref: 'AutomationSript',
                index: true,
            },
        },
    ],
}


/**
 * SAMPLE STRUCTURE OF HOW CRITERIA WILL BE STRUCTURED IN THE DB
 * Depending of on the level, criteria will house all the conditions,
 * in addition to nested condition if present (the nested condition will follow the same structural pattern)
 *
 * criteria: {
 *  condition: 'and',
 *  criteria: [
 *      {
 *         condition: 'or',
 *         criteria: [
 *            {
 *               "responseType": "requestBody",
 *               "filter": "equalTo",
 *                "field1": "ok"
 *            },
 *            {
 *               "responseType": "requestBody",
 *               "filter": "equalTo",
 *                "field1": "healthy"
 *            },
 *            {
 *               condition: 'and',
 *               criteria: [{}, {}, ...]
 *            }
 *         ]
 *      },
 *      {
 *          "responseType": "statusCode",
 *           "filter": "equalTo",
 *           "field1": "200"
 *      },
 *      {
 *           "responseType": "requestTime",
 *           "filter": "lessthan",
 *           "field1": "1000"
 *      },
 *      ...
 *   ]
 * }
 */

export default interface Model extends BaseModel{
    project: Project, //Which project this monitor belongs to.
    componentId: {
        type: Schema.Types.ObjectId,
        ref: 'Component',
        index: true,
    },
    name: string,
    slug: string,
    config: {}, //Can be URL, IP address, or anything that depends on the type.
    createdByUser: { type: string, ref: 'User' }, //user.
    type: {
        type: string,
        enum: [
            'url',
            'manual',
            'api',
            'server-monitor',
            'script',
            'incomingHttpRequest',
            'kubernetes',
            'ip',
        ],
        index: true,
    }, //Type can be 'url', 'process', 'machine'. We can monitor URL, a process in a machine or a server itself.
    agentlessConfig: Object,
    kubernetesConfig: Schema.Types.Mixed,
    kubernetesNamespace: { type: string, default: 'default' },
    ,
    lastPingTime: {
        type: Date,
        default: Date.now,
        index: true,
    },
    updateTime: {
        type: Date,
        default: Date.now,
        index: true,
    },
    criteria: {
        up: { type: [criterionEventSchema], default: [] },
        degraded: { type: [criterionEventSchema], default: [] },
        down: { type: [criterionEventSchema], default: [] },
    },
    lastMatchedCriterion: { type: criterionEventSchema, default: {} },
    method: string,
    bodyType: string,
    formData: [Object],
    text: string,
    headers: [Object],
    disabled: boolean



    deletedByUser: { type: string, ref: 'User' },
    scriptRunStatus: string,
    scriptRunBy: { type: string, ref: 'Probe', index: true },

    lighthouseScannedAt: { type: Date, index: true },
    lighthouseScanStatus: string,
    lighthouseScannedBy: { type: string, ref: 'Probe', index: true },
    siteUrls: [String],
    incidentCommunicationSla: {
        type: Schema.Types.ObjectId,
        ref: 'IncidentCommunicationSla',
    },
    monitorSla: {
        type: Schema.Types.ObjectId,
        ref: 'MonitorSla',
    },
    breachedMonitorSla: boolean,
    breachClosedBy: [{ type: string, ref: 'User' }],
    customFields: [
        {
            fieldName: string,
            fieldValue: Schema.Types.Mixed,
            uniqueField: boolean,
            fieldType: string,
        },
    ],
    shouldNotMonitor: boolean,
    scanning: boolean,
    probeScanning: [String],
    monitorStatus: string,
}

schema.virtual('project', {
    localField: '_id',
    foreignField: 'project',
    ref: 'Project',
    justOne: true,
}









