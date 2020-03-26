const mongoose = require('../config/db');

const Schema = mongoose.Schema;

const globalConfigSchema = new Schema({
    name: String,
    value: Object,

    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('GlobalConfig', globalConfigSchema);
