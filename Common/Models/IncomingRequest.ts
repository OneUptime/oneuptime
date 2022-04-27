import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
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
        isDefault: boolean,
        selectAllMonitors: boolean,
        createIncident: boolean,
        acknowledgeIncident: boolean,
        resolveIncident: boolean,
        updateIncidentNote: boolean,
        updateInternalNote: boolean,
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
                uniqueField: boolean,
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
        createSeparateIncident: boolean,
        post_statuspage: boolean,
    },
    { timestamps: true }
);








