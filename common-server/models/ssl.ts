import mongoose from '../utils/orm';

const Schema = mongoose.Schema;
const sslSchema = new Schema(
    {
        token: String,
        keyAuthorization: String,
        challengeurl: URL,
        deleted: { type: Boolean, default: false },
        deletedAt: Date,
    },
    { timestamps: true }
);
export default mongoose.model('Ssl', sslSchema);
