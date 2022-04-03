import PositiveNumber from 'common/types/PositiveNumber';
import AirtableLib from 'airtable';
import Dictionary from 'common/types/Dictionary';
import { airtableApiKey, airtableBaseId } from '../Config';

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
            .select({ view: airtableView, pageSize: limit.toNumber() })
            .firstPage();
    }

    public static async update(
        tableName: string,
        id: string,
        fields: Dictionary<string>
    ) {
        return this.base(tableName).update(id, fields);
    }

    public static async create(tableName: string, fields: Dictionary<string>) {
        return this.base(tableName).create(fields);
    }

    public static async delete(tableName: string, id: string) {
        return this.base(tableName).destroy(id);
    }
}

export default Airtable;
