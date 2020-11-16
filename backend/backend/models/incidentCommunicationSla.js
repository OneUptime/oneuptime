const mongoose = require('../config/db');
const Schema = mongoose.Schema;

const incidentCommunicationSlaSchema = new Schema(
    {
        name: String,
        monitors: [
            {
                monitorId: { type: Schema.Types.ObjectId, ref: 'Monitor' },
            },
        ],
        projectId: { ref: 'Project', type: Schema.Types.ObjectId },
        isDefault: { type: Boolean, default: false },
        duration: { type: String, default: '60' },
        alertTime: String,
        deleted: { type: Boolean, default: false },
        deletedAt: Date,
    },
    { timestamps: true } //automatically adds createdAt and updatedAt to the collection
);

module.exports = mongoose.model(
    'IncidentCommunicationSla',
    incidentCommunicationSlaSchema
);
