/**
 *
 * Copyright HackerBay, Inc.
 *
 */

var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var auditLogsSchema = new Schema({
    userId: { type: String, ref: 'User' },
    projectId: { type: String, ref: 'Project' },
    request: { type: Object },
    response: { type: Object },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('AuditLog', auditLogsSchema);
