

const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const accountSchema = new Schema(
    {
        id: Schema.Types.Mixed,
        privateKeyPem: Schema.Types.Mixed,
        privateKeyJwk: Schema.Types.Mixed,
        publicKeyPem: Schema.Types.Mixed,
        publicKeyJwk: Schema.Types.Mixed,
        key: Schema.Types.Mixed,
        deleted: { type: Boolean, default: false },
        deletedAt: Date,
    },
    { timestamps: true }
);
module.exports = mongoose.model('Account', accountSchema);
