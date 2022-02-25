import mongoose from '../config/db'

const Schema = mongoose.Schema;

const incomingRequestSchema = new Schema(
    {
        name: String,
        projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
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
        noteContent: String,
        incidentState: String,
        url: String,
        enabled: { type: Boolean, default: true },
        deleted: { type: Boolean, default: false },
        deletedAt: Date,
        incidentTitle: String,
        incidentType: { type: String },
        incidentPriority: {
            type: Schema.Types.Mixed,
            ref: 'IncidentPriority',
            index: true,
        },
        incidentDescription: String,
        customFields: [
            {
                fieldName: String,
                fieldValue: Schema.Types.Mixed,
                uniqueField: { type: Boolean, default: false },
                fieldType: String,
            },
        ],
        filterMatch: String,
        filters: [
            {
                filterCriteria: String,
                filterCondition: {
                    type: String,
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

export default mongoose.model('IncomingRequest', incomingRequestSchema);
