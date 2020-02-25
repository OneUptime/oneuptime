const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const incidentSMSActionSchema = new Schema({
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
    
    deleted: { type: Boolean, default: false},
    
    deletedAt: {
        type: Date
    },

    deletedById: { type: String, ref: 'User' },

});

module.exports = mongoose.model('IncidentSMSAction', incidentSMSActionSchema);

