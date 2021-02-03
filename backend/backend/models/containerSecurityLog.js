const mongoose = require('../config/db');

const Schema = mongoose.Schema;

const containerSecurityLogSchema = Schema(
    {
        securityId: {
            type: Schema.Types.ObjectId,
            ref: 'ContainerSecurity',
            index: true,
        },
        componentId: {
            type: Schema.Types.ObjectId,
            ref: 'Component',
            index: true,
        },
        data: Object,
        deleted: { type: Boolean, default: false },
        deleteAt: Date,
    },
    { timestamps: true }
);

module.exports = mongoose.model(
    'ContainerSecurityLog',
    containerSecurityLogSchema
);
