import Airtable from 'airtable'
import { airtableApiKey, airtableBaseId } from '../config/airtable'

const base = new Airtable({ apiKey: airtableApiKey }).base(airtableBaseId);

export default {
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
