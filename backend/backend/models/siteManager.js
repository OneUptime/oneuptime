const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const siteManagerSchema = new Schema(
    {
        subject: String,
        altnames: Array,
        renewAt: { type: Number, default: 1 },
        expiresAt: { type: Number },
        issuedAt: { type: Number },
        deleted: { type: Boolean, default: false },
        deletedAt: { type: Number },
    },
    { timestamps: true }
);
module.exports = mongoose.model('SiteManager', siteManagerSchema);
