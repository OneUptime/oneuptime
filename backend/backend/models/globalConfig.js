var mongoose = require('../config/db');

var Schema = mongoose.Schema;

var globalConfigSchema = new Schema({
    name: String,
    value: String,

    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('GlobalConfig', globalConfigSchema);