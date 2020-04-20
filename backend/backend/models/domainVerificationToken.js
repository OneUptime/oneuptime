const mongoose = require('mongoose');

const Schema = mongoose.Schema;
const domainVerificationSchema = new Schema({
    domain: String, // the main or base domain eg fyipe.com
    verificationToken: String,
    verified: {
        type: Boolean,
        default: false,
    },
    verifiedAt: Date,
});

module.exports = mongoose.model(
    'DomainVerificationToken',
    domainVerificationSchema
);
