const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const externalStatusPageSchema = new Schema(
    {
        url: String,
        uniqueId: String,
        description: String,
        statusPageId: {
            type: Schema.Types.ObjectId,
            ref: 'StatusPage',
            index: true,
        },
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            index: true,
        },
        deleted: {
            type: Boolean,
            default: false,
        },
        deletedAt: {
            type: Date,
        },
        deletedById: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            index: true,
        },
        createdById: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            index: true,
        },
    },
    { timestamps: true }
);
module.exports = mongoose.model('ExternalStatusPage', externalStatusPageSchema);
