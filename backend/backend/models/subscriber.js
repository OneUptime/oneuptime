const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const subscriberSchema = new Schema({
    monitorId: { type: Schema.Types.ObjectId, ref: 'Monitor', index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    statusPageId: {
        type: Schema.Types.ObjectId,
        ref: 'StatusPage',
        index: true,
    },
    alertVia: {
        type: String,
        enum: ['sms', 'email', 'webhook'],
        required: true,
    },
    contactEmail: { type: String },
    contactPhone: { type: String },
    countryCode: { type: String },
    contactWebhook: { type: String },
    webhookMethod: {
        type: String,
        enum: ['get', 'post'],
        required: true,
    },
    createdAt: { type: Date, default: Date.now },
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: Schema.Types.ObjectId, ref: 'User', index: true },
});
module.exports = mongoose.model('Subscriber', subscriberSchema);
