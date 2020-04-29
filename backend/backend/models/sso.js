const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const ssoSchema = new Schema({
    "saml-enabled": {
        type: Boolean,
        required: true,
    },
    domain:{
        type:String,
        required:true,
    },
    samlSsoUrl: {
        type: String,
        required: true,
    },
    certificateFingerprint: {
        type: String,
        required: true,
    },
    remoteLogoutUrl: {
        type: String,
        required: true,
    },
    ipRanges: {
        type: String,
        required: true,
    },
    createdAt: {
        type: Date,
        required: Date.now,
    },
    deleted: { 
        type: Boolean, 
        default: false 
    },
    deletedAt: {
        type: Date,
    },
    deletedById: { 
        type: String, 
        ref: 'User' 
    },
});

module.exports = mongoose.model('Sso', ssoSchema);
