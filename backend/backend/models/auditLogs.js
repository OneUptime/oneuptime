/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const auditLogsSchema = new Schema({
    userId: { type: String, ref: 'User' },
    projectId: { type: String, ref: 'Project' },
    request: { type: Object },
    response: { type: Object },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

module.exports = mongoose.model('AuditLog', auditLogsSchema);
