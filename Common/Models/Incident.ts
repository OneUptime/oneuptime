import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    idNumber: {
        type: Schema.Types.Number,
        index: true,
    },
    project: Project, //Which project this incident belongs to.
    title: {
        type: Schema.Types.String,
    },
    description: {
        type: Schema.Types.String,
    },
    reason: {
        type: Schema.Types.String,
    },
    response: Object,
    monitors: [
        {
            monitorId: {
                type: Schema.Types.ObjectId,
                ref: 'Monitor',
                index: true,
            },
        },
    ],
    notifications: [
        {
            notificationId: {
                type: string,
                ref: 'Notification',
                index: true,
            },
        },
    ],
    incidentPriority: {
        type: string,
        ref: 'IncidentPriority',
        index: true,
    },
    acknowledged: boolean,
    acknowledgedBy: User, // user
    acknowledgedAt: {
        type: Date,
    },
    acknowledgedByZapier: boolean, // Is true when zapier acknowledges incident

    resolved: boolean,
    incidentType: {
        type: string,
        enum: ['online', 'offline', 'degraded'],
        required: false,
    },
    probes: [
        {
            probeId: { type: string, ref: 'Probe' },
            updatedAt: Date,
            status: boolean,
            reportedStatus: {
                type: string,
                enum: ['online', 'offline', 'degraded'],
                required: false,
            },
        },
    ],
    resolvedBy: User, // user
    resolvedAt: Date,
    resolvedByZapier: boolean, // Is true when zapier resolves incident

    internalNote: { type: string, default: '' },
    investigationNote: { type: string, default: '' },

    createdByUser: User, // user
    createdByApi: boolean,
    ,

    createdByZapier: boolean, // Is true when zapier creates incident

    acknowledgedByApi: boolean,
    resolvedByApi: boolean,

    notClosedBy: [User],
    manuallyCreated: boolean,
    criterionCause: Object,

    



    deletedByUser: User,
    // Has this incident breached communication sla
    breachedCommunicationSla: boolean,
    customFields: [
        {
            fieldName: string,
            fieldValue: Schema.Types.Mixed,
            uniqueField: boolean,
            fieldType: string,
        },
    ],
    acknowledgedByIncomingHttpRequest: { type: string, ref: 'IncomingRequest' },
    resolvedByIncomingHttpRequest: { type: string, ref: 'IncomingRequest' },
    createdByIncomingHttpRequest: { type: string, ref: 'IncomingRequest' },
    hideIncident: boolean,

    slug: string,
}









