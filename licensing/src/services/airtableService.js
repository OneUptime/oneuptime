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
    find: async function({tableName, view}) {
                return new Promise((resolve, reject) => {
                    base(tableName).select({ view }).firstPage((err, records) => {
                        if (err) {
                            reject(err)
                        }
                        resolve(records)           
                    })
                })
            },

    update: async function({ id, email, tableName }) {
                return new Promise((resolve, reject) => {
                    base(tableName).update(id, {
                        "Contact Email": email
                    }, (err, record) => {
                        if (err) {
                            reject(err)
                        }
                        resolve(record)
                    })
                })
            },

    seedData: async function({tableName, license, date}) {
                return new Promise((resolve, reject) => {
                    base(tableName).create([{
                            "fields": {
                                "License Key": license,
                                "Expires": date
                            }
                        }], function(err, records) {
                            if (err) {
                                reject(err);
                            }
                        records.forEach(function (record) {
                            id = record.id;
                            resolve(id)
                        });
                    })
                })
            },

    clearData: async function({tableName, id}) {
                return new Promise((resolve, reject) => {
                    base(tableName).destroy(id, function(err, deletedRecords) {
                        if (err) {
                            reject(err);
                        }
                        resolve(deletedRecords)
                    })
                })
            },
            
    base
};