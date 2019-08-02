var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var statusPageTimeSchema = new Schema({
    monitorId: { type: String, ref: 'Monitor' },
    date: {
        type: Date,
        default: Date.now
    },
    upTime: {
        type: Number,
        default: 0
    },
    downTime: {
        type: Number,
        default: 0
    },
    status: String,
});
module.exports = mongoose.model('StatusPageTime', statusPageTimeSchema);