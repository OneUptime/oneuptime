/* eslint-disable linebreak-style */
/**
 * 
 * Copyright HackerBay, Inc. 
 * 
 */
module.exports = {
    //Description: Create new feedback entry on airtable.
    //Params: 
    //Param 1: data: User data.
    //Returns: promise
    logUser: function (data) {
        var base = new Airtable({ apiKey: apiKey.airtableApiKey }).base('appgek0ngJaHhppeJ');

        return base('User').create({
            'Name': data.name,
            'Email': data.email,
            'Phone': data.phone,
            'Company': data.company,
            'Job Role': data.jobRole,
            'Created At': data.createdAt
        });
    },

    deleteUser: function (userId) {
        var base = new Airtable({ apiKey: apiKey.airtableApiKey }).base('appgek0ngJaHhppeJ');

        return base('User').destroy(userId);
    },
    //Description: Create new feedback entry on airtable.
    //Params: 
    //Param 1: data: Feedback data.
    //Returns: promise
    logFeedback: function (data) {
        var base = new Airtable({ apiKey: apiKey.airtableApiKey }).base('appgek0ngJaHhppeJ');

        return base('Feedback').create({
            'Feedback Text': data.message,
            'User Full Name': data.name,
            'User Email': data.email,
            'Project Name': data.project,
            'Page Name': data.page
        });
    },

    deleteFeedback: function (airtableId) {
        var base = new Airtable({ apiKey: apiKey.airtableApiKey }).base('appgek0ngJaHhppeJ');

        return base('Feedback').destroy(airtableId);
    }
};

var Airtable = require('airtable');
var apiKey = require('../config/keys.js');