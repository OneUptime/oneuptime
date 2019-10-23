var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var subscriberSchema = new Schema({
    monitorId: { type: String, ref: 'Monitor' },
    projectId: { type: String, ref: 'Project' },
    statusPageId: { type: String, ref: 'StatusPage'},
    alertVia: {
        type: String,
        enum: ['sms', 'email', 'webhook'],
        required: true
    },
    contactEmail: {type: String},
    contactPhone: {type: String},
    countryCode: {type: String},
    contactWebhook: { type: String },
    createdAt: { type: Date, default: Date.now },
    deleted: { type: Boolean, default: false, select: false },

    deletedAt: {
        type: Date,
        select: false
    },

    deletedById: { type: String, ref: 'User', select: false },
    __v: { type: Number, select: false }
});
module.exports = mongoose.model('Subscriber', subscriberSchema);