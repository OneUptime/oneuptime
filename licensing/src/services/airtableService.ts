import Airtable from 'airtable';
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../config/airtable"' has no exported memb... Remove this comment to see the full error message
import { airtableApiKey, airtableBaseId } from '../config/airtable';

const base = new Airtable({ apiKey: airtableApiKey }).base(airtableBaseId);

export default {
    find: async function({ tableName, view, limit }: $TSFixMe) {
        return base(tableName)
            .select({ view, pageSize: limit })
            .firstPage();
    },

    update: async function({ tableName, id, fields }: $TSFixMe) {
        return base(tableName).update(id, fields);
    },

    create: async function({ tableName, fields }: $TSFixMe) {
        return base(tableName).create(fields);
    },

    delete: async function({ tableName, id }: $TSFixMe) {
        return base(tableName).destroy(id);
    },
};
