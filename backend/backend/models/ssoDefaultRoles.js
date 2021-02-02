const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const ssoDefaultRoleSchema = new Schema({
    domain: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: 'Sso',
    },
    project: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        required: true,
    },
    role: {
        type: String,
        required: true,
        enum: ['Administrator', 'Member', 'Viewer'],
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

module.exports = mongoose.model('SsoDefaultRole', ssoDefaultRoleSchema);
