const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const errorEventSchema = new Schema({
    errorTrackerId: {
        type: Schema.Types.ObjectId,
        ref: 'ErrorTracker',
        alias: 'errorTracker',
    }, //which error tracker this error event belongs to.
    content: Object,
    type: {
        type: String,
        enum: ['exception', 'message', 'error'],
        required: true,
    },
    timeline: [
        {
            type: Object,
        },
    ],
    tags: [
        {
            type: Object,
        },
    ],
    fingerprint: [
        {
            type: String,
        },
    ],
    fingerprintHash: String,
    device: Object,
    createdById: { type: String, ref: 'User' }, //userId.
    createdAt: {
        type: Date,
        default: Date.now,
    },
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User' },
});

errorEventSchema.virtual('errorTracker', {
    localField: '_id',
    foreignField: 'errorTrackerId',
    ref: 'ErrorTracker',
    justOne: true,
});

module.exports = mongoose.model('ErrorEvent', errorEventSchema);
