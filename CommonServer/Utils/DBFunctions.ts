import Populate from '../Types/DB/Populate';
import { Populate as DbPopulate } from '../Infrastructure/ORM';

export default class DbFunctions {
    public static toDbPopulate(populate?: Populate): Array<DbPopulate> {
        const dbPopulate: Array<DbPopulate> = [];

        if (populate && populate.length > 1) {
            for (const item of populate) {
                dbPopulate.push({
                    select: item.select,
                    populate: this.toDbPopulate(item.populate),
                    path: item.path,
                });
            }
        }

        return dbPopulate;
    }
}
