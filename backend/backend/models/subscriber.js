const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const subscriberSchema = new Schema({
    monitorId: { type: Schema.Types.ObjectId, ref: 'Monitor' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    statusPageId: { type: Schema.Types.ObjectId, ref: 'StatusPage' },
    alertVia: {
        type: String,
        enum: ['sms', 'email', 'webhook'],
        required: true,
    },
    contactEmail: { type: String },
    contactPhone: { type: String },
    countryCode: { type: String },
    contactWebhook: { type: String },
    createdAt: { type: Date, default: Date.now },
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: Schema.Types.ObjectId, ref: 'User' },
});
module.exports = mongoose.model('Subscriber', subscriberSchema);
