/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const auditLogsSchema = new Schema({
    userId: { type: String, ref: 'User',index: true },
    projectId: { type: String, ref: 'Project',index: true },
    request: { type: Object },
    response: { type: Object },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

module.exports = mongoose.model('AuditLog', auditLogsSchema);
