import mongoose from '../config/db';
const Schema = mongoose.Schema;

const { EMAIL_VERIFY_TIME } = process.env;

const verificationToken = new Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User',
        index: true,
    },
    token: {
        type: String,
        required: true,
    },
    createdAt: {
        type: Date,
        required: true,
        default: Date.now,
        expires: Number(EMAIL_VERIFY_TIME) || 3600,
    },
});

export default mongoose.model('VerificationToken', verificationToken);
