const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const errorTrackerSchema = new Schema({
    componentId: {
        type: Schema.Types.ObjectId,
        ref: 'Component',
        alias: 'component',
        index: true,
    }, //which component this error tracker belongs to.
    name: String,
    slug: String,
    key: String,
    showQuickStart: {
        type: Boolean,
        default: true,
    },
    resourceCategory: {
        type: Schema.Types.ObjectId,
        ref: 'ResourceCategory',
        index: true,
    },
    createdById: { type: String, ref: 'User', index: true }, //userId.
    createdAt: {
        type: Date,
        default: Date.now,
    },
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User', index: true },
});

errorTrackerSchema.virtual('component', {
    localField: '_id',
    foreignField: 'componentId',
    ref: 'Component',
    justOne: true,
});

module.exports = mongoose.model('ErrorTracker', errorTrackerSchema);
