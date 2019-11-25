var mongoose = require('../config/db');

var Schema = mongoose.Schema;

/**
 * Represents the Zapier Schema in the database.
 * @var {object} zapierSchema
 * @property {string} projectId - The `ID` of the project the incident is created on.
 * @property {string} url - The zapier hook that the fyipe server pings with new incidents.
 * @property {string} type - The name of trigger that receives the incident object.
 * @property {number} counter - The number of incidents send to the zapier `url`.
 * 
 */
var zapierSchema = new Schema({
    projectId: String,
    url: String,
    type: String,
    monitors: [String],
    deleted: {
        type: Boolean,
        default: false
    }
    
});

module.exports = mongoose.model('Zapier', zapierSchema);