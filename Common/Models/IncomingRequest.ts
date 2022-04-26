import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    {
        name: string,
        project: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
        monitors: [
            {
                monitorId: {
                    type: Schema.Types.ObjectId,
                    ref: 'Monitor',
                    index: true,
                },
            },
        ],
        isDefault: { type: Boolean, default: false },
        selectAllMonitors: { type: Boolean, default: false },
        createIncident: { type: Boolean, default: false },
        acknowledgeIncident: { type: Boolean, default: false },
        resolveIncident: { type: Boolean, default: false },
        updateIncidentNote: { type: Boolean, default: false },
        updateInternalNote: { type: Boolean, default: false },
        noteContent: string,
        incidentState: string,
        url: URL,
        enabled: boolean,
        
        deletedAt: Date,
        incidentTitle: string,
        incidentType: string,
        incidentPriority: {
            type: Schema.Types.Mixed,
            ref: 'IncidentPriority',
            index: true,
        },
        incidentDescription: string,
        customFields: [
            {
                fieldName: string,
                fieldValue: Schema.Types.Mixed,
                uniqueField: { type: Boolean, default: false },
                fieldType: string,
            },
        ],
        filterMatch: string,
        filters: [
            {
                filterCriteria: string,
                filterCondition: {
                    type: string,
                    enum: [
                        'equalTo',
                        'notEqualTo',
                        'lessThan',
                        'greaterThan',
                        'greaterThanOrEqualTo',
                        'lessThanOrEqualTo',
                    ],
                },
                filterText: Schema.Types.Mixed,
            },
        ],
        createSeparateIncident: { type: Boolean, default: false },
        post_statuspage: { type: Boolean, default: false },
    },
    { timestamps: true }
);








