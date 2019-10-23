var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var monitorCategorySchema = new Schema({
    projectId: {
        type: String,
        ref: 'Project',
        alias: 'project'
    },
    name: String,
    createdById: {
        type: String,
        ref: 'User'
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    deleted: {
        type: Boolean,
        default: false,
        select: false
    },
    deletedAt: {
        type: Date,
        select: false
    },
    deletedById: {
        type: String,
        ref: 'User',
        select: false
    },
    __v: { type: Number, select: false }
});

module.exports = mongoose.model('MonitorCategory', monitorCategorySchema);