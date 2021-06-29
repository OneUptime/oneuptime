/**
 *
 * Copyright HackerBay, Inc.
 *
 */

 const mongoose = require('../config/db');

 const Schema = mongoose.Schema;
 const lighthouseSchema = new Schema({
     createdAt: { type: Date, default: Date.now },
     lighthouseKey: { type: String },
     lighthouseName: { type: String },
     version: { type: String },
     lastAlive: { type: Date, default: Date.now },
     deleted: { type: Boolean, default: false },
     deletedAt: { type: Date },
 });
 
 module.exports = mongoose.model('lighthouse', lighthouseSchema);
 