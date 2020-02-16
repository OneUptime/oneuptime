/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const probeSchema = new Schema({
    createdAt: { type: Date, default: Date.now },
    probeKey:{ type: String},
    probeName:{ type: String},
    lastAlive:{ type: Date, default: Date.now },
    deleted: { type: Boolean, default: false},
    deletedAt: {type: Date},
});

module.exports = mongoose.model('Probe', probeSchema);