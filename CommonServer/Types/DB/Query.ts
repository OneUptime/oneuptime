import { JSONValue } from 'Common/Types/JSON';

export default interface Query {
    [x: string]: JSONValue | RegExp | Query;
}
