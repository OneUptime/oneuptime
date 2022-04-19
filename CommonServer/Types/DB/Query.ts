import { JSONValue } from 'Common/Types/JSON';
import { Query as DbQuery } from '../../Infrastructure/ORM';

export interface QueryType {
    [x: string]: JSONValue | RegExp | QueryType;
}

export default class Query {
    private query: QueryType = {};

    public constructor() {
        this.query = {};
    }

    public equalTo(column: string, value: JSONValue): Query {
        this.query[column] = value;
        return this;
    }

    public notEqualTo(column: string, value: JSONValue): Query {
        this.query[column] = { $not: value };
        return this;
    }

    public regexp(column: string, text: string, options: string): Query {
        this.query[column] = { $regex: new RegExp(text), $options: options };
        return this;
    }

    public hasQueryFor(column: string): boolean {
        if (this.query[column]) {
            return true;
        }

        return false;
    }

    public asOrmQuery(): DbQuery<QueryType> {
        const dbQuery: DbQuery<QueryType> = {};

        for (const key in this.query) {
            dbQuery[key] = this.query[key];
        }

        return dbQuery;
    }
}
