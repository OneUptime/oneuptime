/**
 *
 * Copyright HackerBay, Inc.
 *
 */

var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var schema = new Schema({
    from: { type: String, ref: 'Project' },
    to: { type: String, ref: 'User' },
    subject: String,
    body: String,
    createdAt: { type: Date, default: Date.now },
    template: String, 
    status: String,

    deleted: { type: Boolean, default: false},

    deletedAt: {
        type: Date
    },

    deletedById: { type: String, ref: 'User' },
});

module.exports = mongoose.model('EmailSent', schema);