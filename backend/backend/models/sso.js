const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const ssoSchema = new Schema({
    "saml-enabled": Boolean,
    samlSsoUrl: String,
    certificateFingerprint: String,
    remoteLogoutUrl: String,
    ipRanges: String,
    createdAt: Date,
});

module.exports = mongoose.model('Sso', ssoSchema);
