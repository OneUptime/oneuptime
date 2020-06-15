const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const logSchema = new Schema({
    applicationLogId: {
        type: Schema.Types.ObjectId,
        ref: 'ApplicationLog',
        alias: 'applicationLog',
    }, //which application log this content log belongs to.
    content: Object,
    stringifiedContent: String,
    type: {
        type: String,
        enum: ['info', 'warning', 'error'],
        required: true,
    },
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

logSchema.virtual('applicationLog', {
    localField: '_id',
    foreignField: 'applicationLogId',
    ref: 'ApplicationLog',
    justOne: true,
});

module.exports = mongoose.model('Log', logSchema);
