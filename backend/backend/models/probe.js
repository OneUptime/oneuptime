/**
 *
 * Copyright HackerBay, Inc.
 *
 */

var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var probeSchema = new Schema({
    createdAt: { type: Date, default: Date.now },
    probeKey:{ type: String },
    probeName:{ type: String },
    lastAlive:{ type: Date, default: Date.now },
    deleted: { type: Boolean, default: false, select: false },
    deletedAt: { type: Date, select: false },
});

module.exports = mongoose.model('Probe', probeSchema);