/* eslint-disable linebreak-style */
/**
 *
 * Copyright HackerBay, Inc.
 *
 */
module.exports = {
    findLicense: function(license) {
            if (!base) return;

        return base('License').find(license)
        
    },

    updateEmail: function(userDetails) {
            if (!base) return;

        return base('License').update(userDetails.license, {
                "Contact Email": userDetails.email
            })
    }
};

const Airtable = require('airtable');
const AirtableApiKey = process.env['AIRTABLE_API_KEY'];
const AirtableBaseName = process.env['AIRTABLE_BASE_NAME'];
let base = null;
if (AirtableApiKey && AirtableBaseName)
    base = new Airtable({ apiKey: AirtableApiKey }).base(AirtableBaseName);
