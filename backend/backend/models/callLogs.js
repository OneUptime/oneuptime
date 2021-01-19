const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const callLogsSchema = new Schema({
    from: String,
    to: String,
    projectId: { type: String, ref: 'Project' },
    createdAt: { type: Date, default: Date.now },
    deleted: { type: Boolean, default: false },
    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User' },
    content: String,
    status: String,
    error: String,
});
module.exports = mongoose.model('callLogs', callLogsSchema);
