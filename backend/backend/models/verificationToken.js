var mongoose = require('../config/db');
var Schema = mongoose.Schema;

var { EMAIL_VERIFY_TIME } = process.env;

var verificationToken = new Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true, ref: 'User'
    },
    token: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        required: true,
        default: Date.now,
        expires: Number(EMAIL_VERIFY_TIME) || 3600
    },
    __v: { type: Number, select: false }
});

module.exports = mongoose.model('VerificationToken', verificationToken);