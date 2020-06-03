const mongoose = require('../config/db');

const Schema = mongoose.Schema;

const dockerCredentialSchema = Schema(
    {
        dockerRegistryUrl: String,
        dockerUsername: String,
        dockerPassword: String,
        projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
        deleted: {
            type: Boolean,
            default: false,
        },
        deletedAt: Date,
    },
    { timestamps: true }
);

module.exports = mongoose.model('DockerCredential', dockerCredentialSchema);
