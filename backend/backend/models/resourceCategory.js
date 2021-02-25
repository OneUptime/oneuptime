const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const resourceCategorySchema = new Schema({
    projectId: {
        type: String,
        ref: 'Project',
        alias: 'project',
        index: true,
    },
    name: String,
    createdById: {
        type: String,
        ref: 'User',
        index: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    deleted: {
        type: Boolean,
        default: false,
    },
    deletedAt: {
        type: Date,
    },
    deletedById: {
        type: String,
        ref: 'User',
        index: true,
    },
});

module.exports = mongoose.model('ResourceCategory', resourceCategorySchema);
