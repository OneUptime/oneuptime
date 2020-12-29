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
        filterText: String,
    },
    { timestamps: true }
);

module.exports = mongoose.model('IncomingRequest', incomingRequestSchema);
