/**
 *
 * Copyright HackerBay, Inc.
 *
 */
const Airtable = require('airtable');
const { airtableApiKey, airtableBaseId } = require('../config/airtable');

const base = new Airtable({ apiKey: airtableApiKey }).base(airtableBaseId);

module.exports = {
    find: async function({ tableName, view, limit }) {
        return base(tableName)
            .select({ view, pageSize: limit })
            .firstPage();
    },

    update: async function({ tableName, id, fields }) {
        return base(tableName).update(id, fields);
    },

    create: async function({ tableName, fields }) {
        return base(tableName).create(fields);
    },

    delete: async function({ tableName, id }) {
        return base(tableName).destroy(id);
    },
};
