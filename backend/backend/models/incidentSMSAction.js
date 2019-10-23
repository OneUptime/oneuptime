var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var incidentSMSActionSchema = new Schema({
    incidentId: { type: String, ref: 'Incident' }, //which project this incident belongs to.
    userId: { type: String, ref: 'User' }, // which User will perfom this action.
    number:  { type: String },
    name: { type: String },

    resolved: {
        type: Boolean,
        default: false,
    },
    acknowledged: {
        type: Boolean,
        default: false,
    },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 86400
    },
    
    deleted: { type: Boolean, default: false, select: false },
    
    deletedAt: {
        type: Date,
        select: false
    },

    deletedById: { type: String, ref: 'User', select: false },
    __v: { type: Number, select: false }

});

module.exports = mongoose.model('IncidentSMSAction', incidentSMSActionSchema);

