var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var smsCountSchema = new Schema({
    userId: { type: String, ref: 'User', alias: 'users' },
    sentTo: String,
    createdAt: { type: Date, default: Date.now},
    deleted: { type: Boolean, default: false},

    deletedAt: {
        type: Date
    },

    deletedById: { type: String, ref: 'User' },
});
module.exports = mongoose.model('SmsCount', smsCountSchema);