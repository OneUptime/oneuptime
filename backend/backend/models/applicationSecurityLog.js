const mongoose = require('../config/db');

const Schema = mongoose.Schema;

const applicationSecurityLogSchema = Schema(
    {
        securityId: { type: Schema.Types.ObjectId, ref: 'ApplicationSecurity' },
        componentId: { type: Schema.Types.ObjectId, ref: 'Component' },
        data: Object,
        deleted: { type: Boolean, default: false },
        deleteAt: Date,
    },
    { timestamps: true }
);

module.exports = mongoose.model(
    'ApplicationSecurityLog',
    applicationSecurityLogSchema
);
