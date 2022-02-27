import mongoose from '../config/db';

const Schema = mongoose.Schema;
const sslSchema = new Schema(
    {
        token: String,
        keyAuthorization: String,
        challengeUrl: String,
        deleted: { type: Boolean, default: false },
        deletedAt: Date,
    },
    { timestamps: true }
);
export default mongoose.model('Ssl', sslSchema);
