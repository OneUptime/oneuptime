var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var smtpSchema = new Schema({
    projectId: { type: String, ref: 'Project' }, //which project does this belong to.
    user: String,
    pass: String,
    host: String,
    port: String,
    from: String,
    secure:{ type: Boolean, default: true},
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
module.exports = mongoose.model('Smtp', smtpSchema);