const mongoose = require('../config/db');

const Schema = mongoose.Schema;

const dockerCredentialSchema = Schema(
    {
        dockerRegistryUrl: String,
        dockerUsername: String,
        dockerPassword: String,
        iv: Schema.Types.Buffer,
        projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
        deleted: {
            type: Boolean,
            default: false,
        },
        deletedAt: Date,
    },
    { timestamps: true }
);

module.exports = mongoose.model('DockerCredential', dockerCredentialSchema);
