/**
 * 
 * Copyright HackerBay, Inc. 
 * 
 */

const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const feedbackSchema = new Schema({
    projectId: { type: String, ref: 'Project' },
    createdById: { type: String, ref: 'User' },
    airtableId: String,
    message: String,
    page: String,
    deleted: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    deletedAt: {
        type: Date
    },
    deletedById: { type: String, ref: 'User' },
});
module.exports = mongoose.model('Feedback', feedbackSchema);