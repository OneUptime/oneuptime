const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const issueTimelineSchema = new Schema({
    issueId: { type: String, ref: 'Issue', index: true },
    createdById: { type: String, ref: 'User', index: true },

    createdAt: {
        type: Date,
        default: Date.now,
    },

    status: {
        type: String,
        enum: ['ignore', 'unresolved', 'resolved'],
        required: true,
    },

    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedById: { type: String, ref: 'User' },
});
module.exports = mongoose.model('IssueTimeline', issueTimelineSchema);
