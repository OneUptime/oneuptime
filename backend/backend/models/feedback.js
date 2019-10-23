/**
 * 
 * Copyright HackerBay, Inc. 
 * 
 */

var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var feedbackSchema = new Schema({
    projectId: { type: String, ref: 'Project' },
    createdById: { type: String, ref: 'User' },
    message: String,
    page: String,
    deleted: { type: Boolean, default: false, select: false },
    createdAt: { type: Date, default: Date.now },
    deletedAt: {
        type: Date, select: false
    },

    deletedById: { type: String, ref: 'User', select: false },
    __v: { type: Number, select: false }
});
module.exports = mongoose.model('Feedback', feedbackSchema);