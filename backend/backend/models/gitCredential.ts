import mongoose from '../config/db';

const Schema = mongoose.Schema;


const gitCredentialSchema = Schema(
    {
        gitUsername: String,
        gitPassword: String,
        sshTitle: String,
        sshPrivateKey: String,
        iv: Schema.Types.Buffer,
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            index: true,
        },
        deleted: {
            type: Boolean,
            default: false,
        },
        deletedAt: Date,
    },
    { timestamps: true }
);

export default mongoose.model('GitCredential', gitCredentialSchema);
