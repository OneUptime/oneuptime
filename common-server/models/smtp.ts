import mongoose from '../utils/ORM';

const Schema = mongoose.Schema;
const smtpSchema = new Schema({
    projectId: { type: String, ref: 'Project', index: true }, //which project does this belong to.
    user: String,
    pass: String,
    host: String,
    port: String,
    from: String,
    name: String,
    iv: Schema.Types.Buffer,
    secure: { type: Boolean, default: true },
    enabled: { type: Boolean, default: true },
    createdAt: {
        type: Date,
        default: Date.now,
    },

    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User', index: true },
});
export default mongoose.model('Smtp', smtpSchema);
