const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const smsCountSchema = new Schema({
    userId: { type: String, ref: 'User', alias: 'users' },
    sentTo: String,
    createdAt: { type: Date, default: Date.now},
    projectId: { type: String, ref: 'Project' },
    deleted: { type: Boolean, default: false},

    deletedAt: {
        type: Date
    },

    deletedById: { type: String, ref: 'User' },
});
module.exports = mongoose.model('SmsCount', smsCountSchema);