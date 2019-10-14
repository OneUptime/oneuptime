/* eslint-disable linebreak-style */
/**
 * 
 * Copyright HackerBay, Inc. 
 * 
 */
module.exports = {
    //Description: Create new feedback entry on airtable.
    //Params: 
    //Param 1: message: Feedback text.
    //Param 2: userName: User name.
    //Param 3: userEmail: User email.
    //Param 4: projectName: Project name.
    //Param 5: page: Feedback page.
    //Returns: promise
    logFeedback: function (message, userName, userEmail, projectName, page) {
        var base = new Airtable({ apiKey: apiKey.airtableApiKey }).base('appgek0ngJaHhppeJ');

        return base('Feedback').create({
            'Feedback Text': message,
            'User Full Name': userName,
            'User Email': userEmail,
            'Project Name': projectName,
            'Page Name': page
        });
    }
};

var Airtable = require('airtable');
var apiKey = require('../config/keys.js');