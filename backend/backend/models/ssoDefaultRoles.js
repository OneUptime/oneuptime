const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const ssoDefaultRoleSchema = new Schema({
    domain: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: 'Sso',
        index: true
    },
    project: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        required: true,
        index: true
    },
    role: {
        type: String,
        required: true,
        enum: ['Owner', 'Administrator', 'Member', 'Viewer'],
        index: true
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
    },
});
ssoDefaultRoleSchema.index({domain:1,project:1,role:1},{unique:1})

module.exports = mongoose.model('SsoDefaultRole', ssoDefaultRoleSchema);
