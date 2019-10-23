var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var twilioSchema = new Schema({
    projectId: { type: String, ref: 'Project' }, //which project does this belong to.
    accountSid: String,
    authToken: String,
    phoneNumber: String,
    enabled:{ type: Boolean, default: true},
    createdAt: {
        type: Date,
        default: Date.now
    },

    deleted: { type: Boolean, default: false, select: false },

    deletedAt: {
        type: Date,
        select: false
    },

    deletedById: { type: String, ref: 'User', select: false },
    __v: { type: Number, select: false }
});
module.exports = mongoose.model('Twilio', twilioSchema);