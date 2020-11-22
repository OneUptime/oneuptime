const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const issueSchema = new Schema({
    name: String,
    description: String,
    errorTrackerId: {
        type: Schema.Types.ObjectId,
        ref: 'ErrorTracker',
        alias: 'errorTracker',
    }, //which error tracker this issue belongs to.
    type: {
        type: String,
        enum: ['exception', 'message', 'error'],
        required: true,
    },
    fingerprint: [
        {
            type: String,
        },
    ],
    fingerprintHash: String,
    createdAt: {
        type: Date,
        default: Date.now,
    },
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User' },
    resolved: { type: Boolean, default: false },

    resolvedAt: {
        type: Date,
    },

    resolvedById: { type: String, ref: 'User' },
    ignored: { type: Boolean, default: false },

    ignoredAt: {
        type: Date,
    },

    ignoredById: { type: String, ref: 'User' },
});
issueSchema.virtual('errorTracker', {
    localField: '_id',
    foreignField: 'errorTrackerId',
    ref: 'ErrorTracker',
    justOne: true,
});

module.exports = mongoose.model('Issue', issueSchema);
