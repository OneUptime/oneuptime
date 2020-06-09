const mongoose = require('../config/db');

const Schema = mongoose.Schema;

const gitCredentialSchema = Schema(
    {
        gitUsername: String,
        gitPassword: String,
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
        },
        deleted: {
            type: Boolean,
            default: false,
        },
        deletedAt: Date,
    },
    { timestamps: true }
);

module.exports = mongoose.model('GitCredential', gitCredentialSchema);
