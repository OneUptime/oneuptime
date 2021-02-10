const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const callRoutingLogSchema = new Schema({
    callRoutingId: { type: String, ref: 'CallRouting', index: true },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User', index: true },
    callSid: String,
    price: String,
    calledFrom: String,
    calledTo: String,
    duration: String,
    userId: { type: String, ref: 'User', index: true }, // user that call was forwarded to
    scheduleId: { type: String, ref: 'Schedule', index: true }, // scheduleId || ''
});

module.exports = mongoose.model('CallRoutingLog', callRoutingLogSchema);
