/**
 *
 * Copyright HackerBay, Inc.
 *
 */
const Airtable = require('airtable')
const AirtableApiKey = process.env['AIRTABLE_API_KEY'];
const AirtableBaseId = process.env['AIRTABLE_BASE_ID'];
const base = new Airtable({apiKey: AirtableApiKey}).base(AirtableBaseId);

module.exports = {
    findLicense: async function(license) {
        return new Promise((resolve, reject) => {
            base('License').select({
                maxRecords: 3,
                view: "Grid view"
            }).eachPage(function page(records, fetchNextPage) {
                records.forEach(function(record) {
                    let fetchedLicense = record.get("License Key")

                    if(license === fetchedLicense){
                       var result = {}
                           result["id"] = record.id
                           result["expiryDate"] = record.get("Expires"),
                       
                        resolve(result)
                    }
                });
            
                fetchNextPage();     
            }, function done(err) {
                if (err) reject(err)
            }); 
        });
    },

    updateEmail: async function(id, email) {
        return new Promise((resolve, reject) => {
            base('License').update(id, {
                "Contact Email": email
              }, (err, record) => {
                  if (err) {
                    reject(err)
                  }
              
                  resolve(record)
              })
        });
    }
};