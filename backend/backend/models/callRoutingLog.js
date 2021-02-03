const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const callRoutingLogSchema = new Schema({
    callRoutingId: { type: String, ref: 'CallRouting' },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User' },
    calledFrom: String,
    calledTo: String,
    forwardedToId: String,
});

module.exports = mongoose.model('CallRoutingLog', callRoutingLogSchema);
