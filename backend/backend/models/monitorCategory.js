const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const monitorCategorySchema = new Schema({
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
        default: false
    },
    deletedAt: {
        type: Date
    },
    deletedById: {
        type: String,
        ref: 'User'
    }
});

module.exports = mongoose.model('MonitorCategory', monitorCategorySchema);