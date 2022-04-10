import { JSONValue } from 'common/Types/JSON';

export default interface Query {
    [x: string]: JSONValue | RegExp | Query;
}
