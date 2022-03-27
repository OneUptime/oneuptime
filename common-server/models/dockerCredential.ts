import mongoose from '../utils/orm';

const Schema = mongoose.Schema;

const dockerCredentialSchema = new Schema(
    {
        dockerRegistryurl: URL,
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

export default mongoose.model('DockerCredential', dockerCredentialSchema);
