const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const automatedScriptSchema = new Schema({
    name: String,
    script: String,
    createdAt: { type: Date, default: Date.now },
});
module.exports = mongoose.model('scripts', automatedScriptSchema);
