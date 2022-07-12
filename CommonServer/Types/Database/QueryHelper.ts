import { Raw } from "typeorm";

export default class QueryHelper {
    public static findWithSameName(name: string) {
        return Raw((alias) => `LOWER(${alias}) LIKE LOWER(:value)`, {
            value: `%${name}%`,
        })
    }
}