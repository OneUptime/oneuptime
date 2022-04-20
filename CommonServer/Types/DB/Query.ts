import { JSONValue } from 'Common/Types/JSON';
import { Query as DbQuery } from '../../Infrastructure/ORM';

export interface QueryType {
    [x: string]: JSONValue | RegExp | QueryType | Array<JSONValue>;
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

    public in(column: string, value: Array<JSONValue>): Query {
        this.query[column] = { $in: value };
        return this;
    }

    public exist(column: string): Query {
        this.query[column] = { $exists: true };
        return this;
    }

    public doesNotExist(column: string): Query {
        this.query[column] = { $exists: false };
        return this;
    }

    public lessThan(column: string, value: JSONValue): Query {
        this.query[column] = { $lt: value };
        return this;
    }

    public greaterThan(column: string, value: JSONValue): Query {
        this.query[column] = { $gt: value };
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
