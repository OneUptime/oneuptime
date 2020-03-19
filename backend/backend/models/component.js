const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const componentSchema = new Schema({
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        alias: 'project',
    },

    name: String,

    createdById: { type: String, ref: 'User' },
    createdAt: {
        type: Date,
        default: Date.now,
    },

    deleted: { type: Boolean, default: false },

    deletedById: { type: String, ref: 'User' },
    deletedAt: {
        type: Date,
    },
});

componentSchema.virtual('project', {
    localField: '_id',
    foreignField: 'projectId',
    ref: 'Project',
    justOne: true,
});

module.exports = mongoose.model('Component', componentSchema);
