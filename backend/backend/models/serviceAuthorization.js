/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const serviceAuthorizationSchema = new Schema(
    {
        serviceName: {
            type: String,
            required: true,
        },
        serviceKey: {
            type: String,
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model(
    'ServiceAuthorization',
    serviceAuthorizationSchema
);
