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
    find: async function(searchDetails) {
            return new Promise((resolve, reject) => {
                base(searchDetails.tableName).select({
                    view: searchDetails.view
                }).firstPage((err, records) => {
                    if (err) {
                        reject(err)
                    }
                    resolve(records)           
                })
            })
    },

    update: async function(updateDetails) {
        return new Promise((resolve, reject) => {
            base(updateDetails.tableName).update(updateDetails.id, {
                "Contact Email": updateDetails.email
              }, (err, record) => {
                  if (err) {
                    reject(err)
                  }
              
                  resolve(record)
              })
        });
    },
    base
};