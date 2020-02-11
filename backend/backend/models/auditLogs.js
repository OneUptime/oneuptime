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
    reqLog: { type: Object },
    resLog: { type: Object },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('AuditLog', auditLogsSchema);
