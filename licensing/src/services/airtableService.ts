import Airtable from 'airtable';

import { airtableApiKey, airtableBaseId } from '../config/airtable';

const base = new Airtable({ apiKey: airtableApiKey }).base(airtableBaseId);

export default {
    find: async function ({ tableName, view, limit }: $TSFixMe) {
        return base(tableName).select({ view, pageSize: limit }).firstPage();
    },

    update: async function ({ tableName, id, fields }: $TSFixMe) {
        return base(tableName).update(id, fields);
    },

    create: async function ({ tableName, fields }: $TSFixMe) {
        return base(tableName).create(fields);
    },

    delete: async function ({ tableName, id }: $TSFixMe) {
        return base(tableName).destroy(id);
    },
};
