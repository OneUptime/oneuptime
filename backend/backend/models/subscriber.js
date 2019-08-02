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
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date
    },

    deletedById: { type: String, ref: 'User' },
});
module.exports = mongoose.model('Subscriber', subscriberSchema);