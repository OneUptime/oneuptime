var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var subscriberAlertSchema = new Schema({
    projectId: {type: String, ref: 'Project'},
    subscriberId: { type: String, ref: 'Subscriber' },
    incidentId: { type: String, ref: 'Incident' },
    alertVia: {
        type: String,
        enum: ['sms', 'email', 'webhook'],
        required: true
    },
    alertStatus: String,
    createdAt: { type: Date, default: Date.now },
    deleted: { type: Boolean, default: false, select: false },

    deletedAt: {
        type: Date,
        select: false
    },

    deletedById: { type: String, ref: 'User', select: false },
    __v: { type: Number, select: false }
});
module.exports = mongoose.model('SubscriberAlert', subscriberAlertSchema);