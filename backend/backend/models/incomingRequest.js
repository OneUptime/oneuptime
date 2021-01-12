const mongoose = require('../config/db');

const Schema = mongoose.Schema;

const incomingRequestSchema = new Schema(
    {
        name: String,
        projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
        monitors: [
            {
                monitorId: { type: Schema.Types.ObjectId, ref: 'Monitor' },
            },
        ],
        isDefault: { type: Boolean, default: false },
        createIncident: { type: Boolean, default: false },
        acknowledgeIncident: { type: Boolean, default: false },
        resolveIncident: { type: Boolean, default: false },
        updateIncidentNote: { type: Boolean, default: false },
        updateInternalNote: { type: Boolean, default: false },
        noteContent: String,
        incidentState: String,
        url: String,
        deleted: { type: Boolean, default: false },
        deletedAt: Date,
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
        filterText: Schema.Types.Mixed, // expected to store both string and number
        incidentTitle: String,
        incidentType: { type: String },
        incidentPriority: {
            type: Schema.Types.Mixed,
            ref: 'IncidentPriority',
        },
        incidentDescription: String,
        customFields: [{ fieldName: String, fieldValue: Schema.Types.Mixed }],
    },
    { timestamps: true }
);

module.exports = mongoose.model('IncomingRequest', incomingRequestSchema);
