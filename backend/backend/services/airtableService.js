/* eslint-disable linebreak-style */
/**
 * 
 * Copyright HackerBay, Inc. 
 * 
 */
module.exports = {
    //Description: Create new user entry on airtable.
    //Params: 
    //Param 1: data: User data (name, email, phone, company, jobRole, createdAt).
    //Returns: promise
    logUser: function ({ name, email, phone, company, jobRole, createdAt }) {
        return base('User').create({
            'Name': name,
            'Email': email,
            'Phone': phone,
            'Company': company,
            'Job Role': jobRole,
            'Created At': createdAt
        });
    },

    deleteUser: function (airtableId) {
        return base('User').destroy(airtableId);
    },

    //Description: Create new feedback entry on airtable.
    //Params: 
    //Param 1: data: Feedback data (message, name, email, project, page).
    //Returns: promise
    logFeedback: function ({ message, name, email, project, page }) {
        return base('Feedback').create({
            'Feedback Text': message,
            'User Full Name': name,
            'User Email': email,
            'Project Name': project,
            'Page Name': page
        });
    },

    deleteFeedback: function (airtableId) {
        return base('Feedback').destroy(airtableId);
    }
};

const Airtable = require('airtable');
const apiKeys = require('../config/keys.js');
const base = new Airtable({ apiKey: apiKeys.airtableApiKey }).base(apiKeys.airtableBaseId);