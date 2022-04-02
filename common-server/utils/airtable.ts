import PositiveNumber from 'common/types/positive-number';
import AirtableLib from 'airtable';

import { airtableApiKey, airtableBaseId } from '../config';

class Airtable {
    private static base = new AirtableLib({ apiKey: airtableApiKey }).base(
        airtableBaseId
    );

    public static async find(
        tableName: string,
        airtableView: string,
        limit: PositiveNumber
    ) {
        return this.base(tableName)
            .select({ view: airtableView, pageSize: limit })
            .firstPage();
    }

    public static async update(
        tableName: string,
        id: string,
        fields: $TSFixMe
    ) {
        return this.base(tableName).update(id, fields);
    }

    public static async create(tableName: string, fields: $TSFixMe) {
        return this.base(tableName).create(fields);
    }

    public static async delete(tableName: string, id: string) {
        return this.base(tableName).destroy(id);
    }
}

export default Airtable;
