var mongoose = require('../config/db');

var Schema = mongoose.Schema;

var globalConfigSchema = new Schema({
    name: String,
    value: String,

    createdAt: { type: Date, default: Date.now },

    deleted: { type: Boolean, default: false },

    deletedAt: { type: Date },

    deletedById: { type: String, ref: 'User' },
});

module.exports = mongoose.model('GlobalConfig', globalConfigSchema);